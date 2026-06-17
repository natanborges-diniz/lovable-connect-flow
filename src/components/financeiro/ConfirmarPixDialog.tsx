import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useSolicitacaoAnexos } from "@/hooks/useSolicitacaoAnexos";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Clock, User, Store, DollarSign, FileText, Loader2, RotateCcw,
  ImageOff, Info, ExternalLink, Paperclip, Upload,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ConfirmarPixDialogProps {
  solicitacao: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  colunas: any[];
}

const MSG_CONFIRMADO = "PIX confirmado e compensado. Pode liberar a venda.";
const MSG_NAO_CONFIRMADO = "A confirmação de PIX solicitada ainda não foi compensada no banco. Peça nova conferência em alguns instantes.";

export function ConfirmarPixDialog({ solicitacao, open, onOpenChange, colunas }: ConfirmarPixDialogProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [brokenImgIds, setBrokenImgIds] = useState<Set<string>>(new Set());
  const [evidencia, setEvidencia] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { data: anexos } = useSolicitacaoAnexos(solicitacao?.id);

  if (!solicitacao) return null;

  const meta = (solicitacao.metadata || {}) as Record<string, any>;
  const lojaNome = meta.alias_loja || meta.loja_nome || solicitacao.contato?.nome || "Loja";
  const cliente = meta.nome_cliente || meta.cliente || null;
  const valor = meta.valor ?? meta.valor_pix ?? null;
  const dataHora = meta.data_hora || meta.data || meta.horario || null;
  const colAtual = colunas.find((c) => c.id === solicitacao.pipeline_coluna_id);
  const isConfirmado = colAtual?.nome === "PIX Confirmado";
  const isNaoConfirmado = colAtual?.nome === "PIX Não Confirmado";

  // Chaves de controle interno — não mostrar no bloco "Detalhes enviados pela loja"
  const CONTROL_KEYS = new Set([
    "alias_loja", "loja_nome", "cod_empresa", "origem_app",
    "nome_cliente", "cliente", "valor", "valor_pix", "data_hora", "data", "horario",
    "pix_confirmado_at", "pix_nao_confirmado_at", "pix_revertido_at",
    "cancelado_em", "cancelado_por", "motivo_cancelamento",
    "comprovantes", "lojas_map", "loja_selecionada_nome", "loja_selecionada_cod",
    "upload_falhou",
  ]);
  const detalhesExtras = Object.entries(meta).filter(
    ([k, v]) => !CONTROL_KEYS.has(k) && v !== null && v !== undefined && String(v).trim() !== "",
  );
  const semDetalhes = !solicitacao.descricao?.trim() && !cliente && valor == null && !dataHora && detalhesExtras.length === 0;

  const findCol = (nome: string) => colunas.find((c) => c.nome === nome);


  type AnexoEnvio = {
    url: string;
    nome: string;
    mime: string | null;
    storage_path: string;
  } | null;

  const uploadEvidencia = async (): Promise<AnexoEnvio> => {
    if (!evidencia) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Sessão expirada — faça login novamente.");
    const ext = evidencia.name.split(".").pop() || "bin";
    const path = `${user.id}/financeiro/${solicitacao.id}/${Date.now()}-pix-confirm.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("mensagens-anexos").upload(path, evidencia, { contentType: evidencia.type, upsert: false });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from("mensagens-anexos").getPublicUrl(path);
    return { url: pub.publicUrl, nome: evidencia.name, mime: evidencia.type || null, storage_path: path };
  };

  const enviarRetornoLoja = async (mensagem: string, anexo: AnexoEnvio = null, autorNome = "Financeiro") => {
    // 1) Comentário na thread da solicitação (Messenger lê daqui)
    const { error: cErr } = await supabase.from("solicitacao_comentarios").insert({
      solicitacao_id: solicitacao.id,
      tipo: "retorno_setor",
      autor_nome: autorNome,
      conteudo: mensagem,
      ...(anexo ? { anexo_url: anexo.url, anexo_nome: anexo.nome, anexo_mime: anexo.mime } : {}),
      ...(anexo ? { metadata: { tipo: "evidencia_pix", storage_path: anexo.storage_path } } : {}),
    } as any).select();
    if (cErr) {
      console.error("[ConfirmarPixDialog] comentário falhou", cErr);
      toast.error("Comentário não foi salvo: " + cErr.message);
    }

    // 2) Registra anexo na solicitação (aparece no painel do operador também)
    if (anexo) {
      await supabase.from("solicitacao_anexos").insert({
        solicitacao_id: solicitacao.id,
        tipo: "evidencia_pix",
        descricao: "Evidência da confirmação de PIX",
        url_publica: anexo.url,
        storage_path: anexo.storage_path,
        mime_type: anexo.mime,
      } as any);
    }

    // 3) Espelha na thread da demanda Messenger (se houver)
    const demandaId = (meta.demanda_id as string) || null;
    if (demandaId) {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("demanda_mensagens").insert({
        demanda_id: demandaId,
        direcao: "operador_para_loja",
        autor_id: user?.id || null,
        autor_nome: autorNome,
        conteudo: mensagem,
        ...(anexo ? { anexo_url: anexo.url, anexo_mime: anexo.mime } : {}),
        metadata: { tipo: "retorno_pix", solicitacao_id: solicitacao.id },
      } as any);
      await supabase.from("demandas_loja").update({
        status: "respondida",
        vista_pelo_operador: true,
        ultima_mensagem_loja_at: new Date().toISOString(),
      }).eq("id", demandaId);
    }

    const { data: dests, error: rpcErr } = await supabase.rpc("resolver_destinatarios_loja", { _loja_nome: lojaNome });
    if (rpcErr) {
      console.error("[ConfirmarPixDialog] resolver_destinatarios_loja falhou", rpcErr);
      toast.error("Não foi possível identificar destinatários da loja.");
      return;
    }
    const list = (dests || []) as Array<{ user_id: string; setor_id: string | null }>;
    if (list.length === 0) {
      toast.warning(`Nenhum usuário cadastrado para a loja "${lojaNome}" — notificação não enviada.`);
      return;
    }

    const titulo = `Retorno do Financeiro — ${solicitacao.protocolo || "PIX"}`;
    const { error: nErr } = await supabase.from("notificacoes").insert(
      list.map((d) => ({
        usuario_id: d.user_id,
        setor_id: d.setor_id,
        tipo: "retorno_setor",
        titulo,
        mensagem: anexo ? `${mensagem} (com evidência anexada)` : mensagem,
        referencia_id: solicitacao.id,
      })) as any
    ).select();
    if (nErr) {
      console.error("[ConfirmarPixDialog] notificações falharam", nErr);
      toast.error("Loja não foi notificada: " + nErr.message);
    }
  };


  const moverPara = async (colNome: string, metaPatch: Record<string, any>, statusFinal: string | null) => {
    const target = findCol(colNome);
    if (!target) {
      toast.error(`Coluna "${colNome}" não encontrada.`);
      return null;
    }
    const updatePayload: any = {
      pipeline_coluna_id: target.id,
      metadata: { ...meta, ...metaPatch },
    };
    if (statusFinal) updatePayload.status = statusFinal;
    const { error } = await supabase.from("solicitacoes").update(updatePayload).eq("id", solicitacao.id);
    if (error) throw error;
    return target;
  };

  const handleConfirmar = async () => {
    setBusy("confirmar");
    try {
      const anexo = await uploadEvidencia();
      const target = await moverPara(
        "PIX Confirmado",
        {
          pix_confirmado_at: new Date().toISOString(),
          ...(anexo ? { pix_evidencia_url: anexo.url, pix_evidencia_nome: anexo.nome } : {}),
        },
        "concluida"
      );
      if (!target) return;

      await enviarRetornoLoja(MSG_CONFIRMADO, anexo);

      if (solicitacao.contato_id) {
        await supabase.from("eventos_crm").insert({
          contato_id: solicitacao.contato_id,
          tipo: "pix_confirmado",
          descricao: `PIX confirmado pelo Financeiro — loja ${lojaNome}${anexo ? " (com evidência)" : ""}`,
          referencia_tipo: "solicitacao",
          referencia_id: solicitacao.id,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] });
      toast.success(anexo ? "PIX confirmado com evidência. Loja foi notificada." : "PIX confirmado. Loja foi notificada.");
      setEvidencia(null);
      if (fileRef.current) fileRef.current.value = "";
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao confirmar: " + err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleNaoConfirmar = async () => {
    setBusy("nao_confirmar");
    try {
      const anexo = await uploadEvidencia();
      const target = await moverPara(
        "PIX Não Confirmado",
        { pix_nao_confirmado_at: new Date().toISOString() },
        "concluida"
      );
      if (!target) return;

      await enviarRetornoLoja(MSG_NAO_CONFIRMADO, anexo);

      if (solicitacao.contato_id) {
        await supabase.from("eventos_crm").insert({
          contato_id: solicitacao.contato_id,
          tipo: "pix_nao_confirmado",
          descricao: `PIX não compensado — loja ${lojaNome} pode pedir nova conferência`,
          referencia_tipo: "solicitacao",
          referencia_id: solicitacao.id,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] });
      toast.success("Marcado como não confirmado. Loja foi avisada.");
      setEvidencia(null);
      if (fileRef.current) fileRef.current.value = "";
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleReverter = async () => {
    setBusy("reverter");
    try {
      const target = await moverPara(
        "PIX Não Confirmado",
        { pix_revertido_at: new Date().toISOString(), pix_confirmado_at: null },
        "concluida"
      );
      if (!target) return;
      queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] });
      toast.success("Card revertido para PIX Não Confirmado.");
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Confirmação de PIX — {solicitacao.protocolo || solicitacao.assunto}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Loja</p>
                <p className="font-medium">{lojaNome}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Aberto</p>
                <p className="font-medium">{format(new Date(solicitacao.created_at), "dd/MM HH:mm", { locale: ptBR })}</p>
              </div>
            </div>
            {cliente && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Cliente</p>
                  <p className="font-medium">{cliente}</p>
                </div>
              </div>
            )}
            {valor != null && String(valor).trim() !== "" && (
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Valor</p>
                  <p className="font-medium">
                    {(() => {
                      const n = Number(String(valor).replace(/\./g, "").replace(",", "."));
                      return Number.isFinite(n) ? `R$ ${n.toFixed(2)}` : String(valor);
                    })()}
                  </p>
                </div>
              </div>
            )}
            {dataHora && (
              <div className="flex items-center gap-2 col-span-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Data/Horário informado</p>
                  <p className="font-medium">{String(dataHora)}</p>
                </div>
              </div>
            )}
          </div>

          {solicitacao.descricao?.trim() && (
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Descrição</p>
              <p className="text-sm whitespace-pre-wrap">{solicitacao.descricao}</p>
            </div>
          )}

          {detalhesExtras.length > 0 && (
            <div className="bg-muted/30 rounded-lg p-3 space-y-1">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Detalhes enviados pela loja</p>
              {detalhesExtras.map(([k, v]) => (
                <div key={k} className="flex gap-2 text-xs">
                  <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}:</span>
                  <span className="font-medium break-all">{String(v)}</span>
                </div>
              ))}
            </div>
          )}

          {semDetalhes && (!anexos || anexos.length === 0) && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-800">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p className="text-xs">
                A loja não enviou detalhes nem comprovante via Messenger. Solicite reenvio antes de confirmar.
              </p>
            </div>
          )}

          {anexos && anexos.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Comprovante(s) enviado(s) pela loja</p>
              <div className="grid grid-cols-2 gap-2">
                {anexos.map((a: any) => {
                  const isImg = a.mime_type?.startsWith("image/");
                  const broken = brokenImgIds.has(a.id);
                  return (
                    <a
                      key={a.id}
                      href={a.url_publica}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block border rounded-lg overflow-hidden hover:ring-2 hover:ring-primary/40 transition"
                    >
                      {isImg && !broken ? (
                        <img
                          src={a.url_publica}
                          alt={a.descricao || "Comprovante"}
                          className="w-full h-32 object-cover"
                          onError={() => setBrokenImgIds((prev) => new Set(prev).add(a.id))}
                        />
                      ) : isImg && broken ? (
                        <div className="flex flex-col items-center justify-center gap-1 h-32 p-3 bg-muted/40 text-muted-foreground">
                          <ImageOff className="h-5 w-5" />
                          <span className="text-[10px] text-center">Imagem indisponível no storage</span>
                          <span className="text-[10px] inline-flex items-center gap-1 text-primary">
                            Abrir URL original <ExternalLink className="h-3 w-3" />
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 p-3">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <span className="text-xs truncate">{a.descricao || "Anexo"}</span>
                        </div>
                      )}
                    </a>
                  );
                })}
              </div>
            </div>
          )}


          {isConfirmado && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-700 border border-green-500/30">
              <CheckCircle2 className="h-5 w-5" />
              <div className="flex-1">
                <p className="font-medium text-sm">PIX Confirmado</p>
                {meta.pix_confirmado_at && (
                  <p className="text-xs">em {format(new Date(meta.pix_confirmado_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                )}
              </div>
            </div>
          )}

          {isNaoConfirmado && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-700 border border-yellow-500/30">
              <XCircle className="h-5 w-5" />
              <div className="flex-1">
                <p className="font-medium text-sm">PIX ainda não compensado</p>
                <p className="text-xs">A loja pode pedir nova conferência pela demanda.</p>
              </div>
            </div>
          )}

          {!isConfirmado && (
            <div className="space-y-1 pt-2 border-t">
              <Label className="text-xs flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                Evidência para a loja (imagem/PDF, opcional)
              </Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".pdf,image/*"
                disabled={!!busy}
                onChange={(e) => setEvidencia(e.target.files?.[0] ?? null)}
              />
              {evidencia && (
                <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                  <Upload className="h-3 w-3" /> {evidencia.name} · {(evidencia.size / 1024).toFixed(0)} KB — será enviada à loja na demanda do Messenger.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2 border-t">

            {!isConfirmado && (
              <Button
                onClick={handleConfirmar}
                disabled={!!busy}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {busy === "confirmar" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Confirmar PIX
              </Button>
            )}
            {!isNaoConfirmado && !isConfirmado && (
              <Button
                onClick={handleNaoConfirmar}
                disabled={!!busy}
                variant="destructive"
              >
                {busy === "nao_confirmar" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
                Não confirmar (sem compensação)
              </Button>
            )}
            {isConfirmado && (
              <Button onClick={handleReverter} disabled={!!busy} variant="outline">
                {busy === "reverter" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                Reverter para "Não Confirmado"
              </Button>
            )}
            {isNaoConfirmado && (
              <Button onClick={handleConfirmar} disabled={!!busy} className="bg-green-600 hover:bg-green-700 text-white">
                {busy === "confirmar" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Compensou agora — Confirmar PIX
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

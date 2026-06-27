import { useState, useRef } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, FileCheck, Receipt, Upload, FileText, X } from "lucide-react";


type Modo = "carta" | "comprovante_pagamento" | "boleto";

interface Props {
  solicitacaoId: string | null;
  modo: Modo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function ConcluirSolicitacaoDialog({
  solicitacaoId, modo, open, onOpenChange, onSuccess,
}: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [nsu, setNsu] = useState("");
  const [tid, setTid] = useState("");
  const [valor, setValor] = useState("");
  const [dataPagamento, setDataPagamento] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [observacao, setObservacao] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const isComprovante = modo === "comprovante_pagamento";
  const isBoleto = modo === "boleto";
  const allowMultiple = isBoleto;

  const titulo =
    isComprovante ? "Concluir pagamento" :
    isBoleto ? "Anexar boleto(s) e enviar" :
    "Concluir com carta de estorno";
  const descricao =
    isComprovante
      ? "Envie o comprovante de pagamento (PDF ou imagem). NSU e valor são obrigatórios. A loja recebe o comprovante no app."
      : isBoleto
      ? "Anexe 1 ou mais arquivos (PDF/imagem). O card vai para 'Boleto Enviado' e a loja recebe os arquivos no app. Se a loja pediu impressão na abertura, esse aviso já aparece no card — imprima e envie por malote."
      : "Envie a carta de devolução do estorno (PDF ou imagem). A loja recebe a carta no app e pode encaminhar ao cliente.";
  const accept = ".pdf,image/*";
  const Icon = isComprovante ? Receipt : isBoleto ? FileText : FileCheck;

  const reset = () => {
    setFiles([]); setNsu(""); setTid(""); setValor("");
    setDataPagamento(new Date().toISOString().slice(0, 10));
    setObservacao("");
    if (fileRef.current) fileRef.current.value = "";
  };


  const canSubmit =
    files.length > 0 && !!solicitacaoId &&
    (!isComprovante || (nsu.trim().length >= 3 && Number(valor) > 0));

  const handle = async () => {
    if (files.length === 0 || !solicitacaoId) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada — faça login novamente.");

      // Upload de cada arquivo no bucket público
      const anexos: any[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const ext = f.name.split(".").pop() || "bin";
        const path = `${user.id}/financeiro/${solicitacaoId}/${Date.now()}-${i}-${modo}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("mensagens-anexos").upload(path, f, { contentType: f.type, upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("mensagens-anexos").getPublicUrl(path);
        anexos.push({
          url: pub.publicUrl,
          storage_path: path,
          mime_type: f.type,
          nome: f.name,
          tamanho_bytes: f.size,
        });
      }

      const payload: Record<string, unknown> = {
        solicitacao_id: solicitacaoId,
        modo,
        anexos,                  // novo: lista
        anexo: anexos[0],        // compat: 1º
        observacao: observacao.trim() || undefined,
      };
      if (isComprovante) {
        payload.nsu = nsu.trim();
        payload.tid = tid.trim() || undefined;
        payload.valor = Number(valor);
        payload.data_pagamento = dataPagamento;
      }
      // boleto: nenhum campo extra — flag de impressão veio da abertura pela loja

      const { data, error } = await supabase.functions.invoke("concluir-solicitacao-financeiro", { body: payload });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      toast.success(
        isComprovante ? "Pagamento concluído e comprovante enviado à loja." :
        isBoleto ? "Boleto(s) enviado(s) à loja." :
        "Estorno concluído. Carta enviada à loja."
      );

      reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      toast.error("Falha ao concluir: " + (e?.message || "erro"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-emerald-600" />
            {titulo}
          </DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">
              {isComprovante ? "Comprovante (PDF/imagem) *" :
               isBoleto ? "Boleto(s) — 1 ou mais (PDF/imagem) *" :
               "Carta de devolução (PDF/imagem) *"}
            </Label>
            <Input
              ref={fileRef}
              type="file"
              accept={accept}
              multiple={allowMultiple}
              onChange={(e) => {
                const list = Array.from(e.target.files || []);
                setFiles(allowMultiple ? list : list.slice(0, 1));
              }}
            />
            {files.length > 0 && (
              <ul className="space-y-0.5">
                {files.map((f, i) => (
                  <li key={i} className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                    <Upload className="h-3 w-3" /> {f.name} · {(f.size / 1024).toFixed(0)} KB
                    <button
                      type="button"
                      className="ml-auto text-destructive hover:text-destructive/70"
                      onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isBoleto && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-2">
              <Checkbox
                id="boleto-impresso"
                checked={boletoImpresso}
                onCheckedChange={(v) => setBoletoImpresso(!!v)}
              />
              <div className="space-y-0.5">
                <Label htmlFor="boleto-impresso" className="text-xs font-medium cursor-pointer">
                  Imprimir e entregar fisicamente
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Loja recebe alerta para imprimir antes da entrega ao cliente.
                </p>
              </div>
            </div>
          )}

          {isComprovante && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">NSU *</Label>
                  <Input value={nsu} onChange={(e) => setNsu(e.target.value)} placeholder="123456" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">TID (opcional)</Label>
                  <Input value={tid} onChange={(e) => setTid(e.target.value)} placeholder="—" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Valor pago *</Label>
                  <Input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data</Label>
                  <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
                </div>
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea
              rows={2}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Mensagem extra para a loja…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>Cancelar</Button>
          <Button onClick={handle} disabled={!canSubmit || uploading}>
            {uploading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            {isComprovante ? "Concluir pagamento" :
             isBoleto ? `Enviar ${files.length || ""} boleto${files.length !== 1 ? "s" : ""}`.trim() :
             "Concluir e enviar carta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

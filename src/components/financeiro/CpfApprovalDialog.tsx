import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, Upload, FileText, Download,
  DollarSign, User, CreditCard, Clock, Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CpfApprovalDialogProps {
  solicitacao: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  colunas: any[];
}

export function CpfApprovalDialog({ solicitacao, open, onOpenChange, colunas }: CpfApprovalDialogProps) {
  const queryClient = useQueryClient();
  const [justificativa, setJustificativa] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [action, setAction] = useState<"aprovar" | "reprovar" | null>(null);

  const meta = solicitacao?.metadata || {};
  const nomeCliente = meta.nome_cliente || "—";
  const cpf = meta.cpf || "—";
  const valorCompra = meta.valor_compra != null ? Number(meta.valor_compra) : null;
  const valorEntrada = meta.valor_entrada != null ? Number(meta.valor_entrada) : null;
  const valorFinanciado = meta.valor_financiado != null ? Number(meta.valor_financiado) : null;

  const existingDocUrl = meta.documento_url || null;

  const findColuna = (nome: string) => colunas.find((c) => c.nome === nome);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (f.size > 10 * 1024 * 1024) {
        toast.error("Arquivo muito grande. Máximo 10MB.");
        return;
      }
      setFile(f);
    }
  };

  const handleAction = async (tipo: "aprovar" | "reprovar") => {
    if (!file && !existingDocUrl) {
      toast.error("Upload do documento de consulta é obrigatório.");
      return;
    }
    if (tipo === "reprovar" && !justificativa.trim()) {
      toast.error("Justificativa é obrigatória para reprovação.");
      return;
    }

    setAction(tipo);
    setUploading(true);

    try {
      let documentoUrl = existingDocUrl;

      // Upload file if new
      if (file) {
        const ext = file.name.split(".").pop() || "pdf";
        const path = `${solicitacao.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("cpf-documentos")
          .upload(path, file, { contentType: file.type });
        if (uploadError) throw uploadError;

        documentoUrl = path; // Store path, generate signed URL on demand
      }

      // Determine target column
      const targetColName = tipo === "aprovar" ? "Consulta CPF Aprovado" : "Consulta CPF Reprovada";
      const targetCol = findColuna(targetColName);

      // Update metadata with document and justification
      const updatedMetadata = {
        ...meta,
        documento_path: file ? `${solicitacao.id}/${Date.now()}.${file.name.split(".").pop() || "pdf"}` : meta.documento_path,
        documento_url: documentoUrl,
        resultado_consulta: tipo === "aprovar" ? "aprovado" : "reprovado",
        justificativa_interna: justificativa || null,
        data_analise: new Date().toISOString(),
      };

      // Update solicitação
      const updatePayload: any = {
        metadata: updatedMetadata,
        status: tipo === "aprovar" ? "concluida" : "concluida",
      };
      if (targetCol) {
        updatePayload.pipeline_coluna_id = targetCol.id;
      }

      const { error: updateError } = await supabase
        .from("solicitacoes")
        .update(updatePayload)
        .eq("id", solicitacao.id);

      if (updateError) throw updateError;

      // Log CRM event
      if (solicitacao.contato_id) {
        await supabase.from("eventos_crm").insert({
          contato_id: solicitacao.contato_id,
          tipo: tipo === "aprovar" ? "cpf_aprovado" : "cpf_reprovado",
          descricao: tipo === "aprovar"
            ? `CPF ${cpf} de ${nomeCliente} aprovado para financiamento de R$ ${valorFinanciado?.toFixed(2)}`
            : `CPF ${cpf} de ${nomeCliente} reprovado. Justificativa: ${justificativa}`,
          referencia_tipo: "solicitacao",
          referencia_id: solicitacao.id,
          metadata: updatedMetadata,
        });
      }

      // Trigger pipeline automations
      if (targetCol) {
        try {
          await supabase.functions.invoke("pipeline-automations", {
            body: {
              entity_type: "solicitacao",
              entity_id: solicitacao.id,
              coluna_id: targetCol.id,
              coluna_anterior_id: solicitacao.pipeline_coluna_id,
            },
          });
        } catch (e) {
          console.warn("Pipeline automation call failed:", e);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["solicitacoes_financeiro"] });
      toast.success(tipo === "aprovar" ? "CPF aprovado com sucesso!" : "CPF reprovado.");
      onOpenChange(false);
      resetForm();
    } catch (err: any) {
      console.error("Error processing CPF:", err);
      toast.error("Erro ao processar: " + err.message);
    } finally {
      setUploading(false);
      setAction(null);
    }
  };

  const resetForm = () => {
    setJustificativa("");
    setFile(null);
    setAction(null);
  };

  const handleDownloadDoc = async () => {
    if (!meta.documento_url) return;
    try {
      const { data, error } = await supabase.storage
        .from("cpf-documentos")
        .createSignedUrl(meta.documento_url, 3600);
      if (error) throw error;
      window.open(data.signedUrl, "_blank");
    } catch (err: any) {
      toast.error("Erro ao baixar documento: " + err.message);
    }
  };

  if (!solicitacao) return null;

  const isConsultaCpf = solicitacao.tipo === "consulta_cpf";
  const alreadyProcessed = meta.resultado_consulta != null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            {solicitacao.assunto}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {solicitacao.contato && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Solicitante (Loja)</p>
                  <p className="font-medium">{solicitacao.contato.nome}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Data</p>
                <p className="font-medium">{format(new Date(solicitacao.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
              </div>
            </div>
          </div>

          {/* CPF Details */}
          {isConsultaCpf && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <h4 className="font-semibold text-sm">Dados da Consulta</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Cliente</span>
                  <p className="font-medium">{nomeCliente}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">CPF</span>
                  <p className="font-medium font-mono">{cpf}</p>
                </div>
                {valorCompra != null && (
                  <div>
                    <span className="text-muted-foreground text-xs">Valor da compra</span>
                    <p className="font-medium text-primary">R$ {valorCompra.toFixed(2)}</p>
                  </div>
                )}
                {valorEntrada != null && (
                  <div>
                    <span className="text-muted-foreground text-xs">Entrada</span>
                    <p className="font-medium">R$ {valorEntrada.toFixed(2)}</p>
                  </div>
                )}
                {valorFinanciado != null && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground text-xs">Valor a financiar</span>
                    <p className="font-semibold text-lg flex items-center gap-1">
                      <DollarSign className="h-4 w-4" />
                      R$ {valorFinanciado.toFixed(2)}
                    </p>
                  </div>
                )}
                {meta.motivo && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground text-xs">Motivo</span>
                    <p>{meta.motivo}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Already processed badge */}
          {alreadyProcessed && (
            <div className={`flex items-center gap-2 p-3 rounded-lg ${
              meta.resultado_consulta === "aprovado" ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive"
            }`}>
              {meta.resultado_consulta === "aprovado"
                ? <CheckCircle className="h-5 w-5" />
                : <XCircle className="h-5 w-5" />}
              <span className="font-medium">
                {meta.resultado_consulta === "aprovado" ? "CPF Aprovado" : "CPF Reprovado"}
              </span>
              {meta.data_analise && (
                <span className="text-xs ml-auto">
                  em {format(new Date(meta.data_analise), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </span>
              )}
            </div>
          )}

          {/* Existing document */}
          {meta.documento_url && (
            <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm">Documento de consulta anexado</span>
              </div>
              <Button variant="outline" size="sm" onClick={handleDownloadDoc}>
                <Download className="h-4 w-4 mr-1" /> Baixar
              </Button>
            </div>
          )}

          {/* Existing justification */}
          {alreadyProcessed && meta.justificativa_interna && (
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Justificativa interna</p>
              <p className="text-sm">{meta.justificativa_interna}</p>
            </div>
          )}

          {/* Description */}
          {solicitacao.descricao && !isConsultaCpf && (
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-1">Descrição</p>
              <p className="text-sm whitespace-pre-wrap">{solicitacao.descricao}</p>
            </div>
          )}

          {/* Action area - only for unprocessed consulta_cpf */}
          {isConsultaCpf && !alreadyProcessed && (
            <div className="space-y-4 pt-4 border-t">
              {/* Document upload */}
              <div>
                <Label className="text-sm font-medium">
                  Documento de consulta <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Anexe o resultado da consulta de CPF (PDF ou imagem)
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    onChange={handleFileChange}
                    className="text-sm"
                  />
                  {file && (
                    <Badge variant="outline" className="shrink-0">
                      <FileText className="h-3 w-3 mr-1" />
                      {file.name.length > 20 ? file.name.slice(0, 20) + "..." : file.name}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Justification */}
              <div>
                <Label className="text-sm font-medium">
                  Observação / Justificativa {" "}
                  <span className="text-xs text-muted-foreground">(obrigatória em caso de reprovação)</span>
                </Label>
                <Textarea
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  placeholder="Observações internas sobre a consulta..."
                  rows={3}
                  className="mt-1"
                />
              </div>

              {/* Action buttons */}
              <div className="flex gap-3">
                <Button
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => handleAction("aprovar")}
                  disabled={uploading}
                >
                  {uploading && action === "aprovar" ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-1" />
                  )}
                  Aprovar CPF
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => handleAction("reprovar")}
                  disabled={uploading}
                >
                  {uploading && action === "reprovar" ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <XCircle className="h-4 w-4 mr-1" />
                  )}
                  Reprovar CPF
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

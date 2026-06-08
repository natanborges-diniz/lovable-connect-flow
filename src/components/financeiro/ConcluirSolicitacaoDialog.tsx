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
import { Loader2, FileCheck, Receipt, Upload } from "lucide-react";

type Modo = "carta" | "comprovante_pagamento";

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
  const [file, setFile] = useState<File | null>(null);
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
  const titulo = isComprovante ? "Concluir pagamento" : "Concluir com carta de estorno";
  const descricao = isComprovante
    ? "Envie o comprovante de pagamento (PDF ou imagem). NSU e valor são obrigatórios. A loja recebe o comprovante no app."
    : "Envie a carta de devolução do estorno (PDF ou imagem). A loja recebe a carta no app e pode encaminhar ao cliente.";
  const accept = ".pdf,image/*";
  const Icon = isComprovante ? Receipt : FileCheck;

  const reset = () => {
    setFile(null); setNsu(""); setTid(""); setValor("");
    setDataPagamento(new Date().toISOString().slice(0, 10));
    setObservacao(""); if (fileRef.current) fileRef.current.value = "";
  };

  const canSubmit = !!file && !!solicitacaoId &&
    (!isComprovante || (nsu.trim().length >= 3 && Number(valor) > 0));

  const handle = async () => {
    if (!file || !solicitacaoId) return;
    setUploading(true);
    try {
      // Upload pro bucket público mensagens-anexos
      const ext = file.name.split(".").pop() || "bin";
      const path = `financeiro/${solicitacaoId}/${Date.now()}-${modo}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("mensagens-anexos").upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("mensagens-anexos").getPublicUrl(path);

      const payload: Record<string, unknown> = {
        solicitacao_id: solicitacaoId,
        modo,
        anexo: {
          url: pub.publicUrl,
          storage_path: path,
          mime_type: file.type,
          nome: file.name,
          tamanho_bytes: file.size,
        },
        observacao: observacao.trim() || undefined,
      };
      if (isComprovante) {
        payload.nsu = nsu.trim();
        payload.tid = tid.trim() || undefined;
        payload.valor = Number(valor);
        payload.data_pagamento = dataPagamento;
      }
      const { data, error } = await supabase.functions.invoke("concluir-solicitacao-financeiro", { body: payload });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      toast.success(isComprovante ? "Pagamento concluído e comprovante enviado à loja." : "Estorno concluído. Carta enviada à loja.");
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
              {isComprovante ? "Comprovante (PDF/imagem) *" : "Carta de devolução (PDF/imagem) *"}
            </Label>
            <Input
              ref={fileRef}
              type="file"
              accept={accept}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                <Upload className="h-3 w-3" /> {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            )}
          </div>

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
            {isComprovante ? "Concluir pagamento" : "Concluir e enviar carta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

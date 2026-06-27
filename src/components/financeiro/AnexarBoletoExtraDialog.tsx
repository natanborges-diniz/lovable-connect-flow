import { useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Paperclip, Upload, X } from "lucide-react";

interface Props {
  solicitacaoId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function AnexarBoletoExtraDialog({ solicitacaoId, open, onOpenChange, onSuccess }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [observacao, setObservacao] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setFiles([]); setObservacao("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const canSubmit = files.length > 0 && !!solicitacaoId && !uploading;

  const handle = async () => {
    if (!solicitacaoId || files.length === 0) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada — faça login novamente.");

      const anexos: any[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const ext = f.name.split(".").pop() || "bin";
        const path = `${user.id}/financeiro/${solicitacaoId}/extras/${Date.now()}-${i}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("mensagens-anexos").upload(path, f, { contentType: f.type, upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("mensagens-anexos").getPublicUrl(path);
        anexos.push({
          url: pub.publicUrl, storage_path: path,
          mime_type: f.type, nome: f.name, tamanho_bytes: f.size,
        });
      }
      if (anexos.length === 0) throw new Error("Nenhum arquivo enviado.");

      const { data, error } = await supabase.functions.invoke("anexar-boleto-extra", {
        body: { solicitacao_id: solicitacaoId, anexos, observacao: observacao.trim() || undefined },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      toast.success(`${anexos.length} arquivo(s) adicional(is) enviado(s) à loja.`);
      reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      toast.error("Falha ao anexar: " + (e?.message || "erro"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-primary" /> Anexar arquivo ao boleto
          </DialogTitle>
          <DialogDescription>
            Adiciona arquivos extras a um boleto já enviado, sem gastar ciclo de revisão. Os arquivos somam aos atuais e a loja é notificada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Arquivo(s) adicional(is) (PDF/imagem) *</Label>
            <Input
              ref={fileRef}
              type="file"
              accept=".pdf,image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
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
          <div className="space-y-1">
            <Label className="text-xs">Observação (opcional)</Label>
            <Textarea
              rows={2}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex.: 2ª via do boleto da parcela 3, comprovante de envio…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>Cancelar</Button>
          <Button onClick={handle} disabled={!canSubmit}>
            {uploading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Enviar {files.length || ""} arquivo{files.length !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

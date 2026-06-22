import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PackageCheck, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Preview = {
  os_numero: string;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  loja_nome_os: string | null;
  cod_empresa: number | null;
  cod_etapa_atual: number | null;
  etapa_label: string | null;
  produtos: Array<{ descricao?: string } | string>;
};

interface Props {
  /** Nome da loja do usuário logado (passado pelo container). */
  lojaPadrao?: string | null;
  /** Render prop opcional do trigger; default é botão "Receber OS". */
  trigger?: React.ReactNode;
}

export function ConfirmarRecebimentoOSDialog({ lojaPadrao, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [osNumero, setOsNumero] = useState("");
  const [lojaNome, setLojaNome] = useState(lojaPadrao ?? "");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [jaRecebida, setJaRecebida] = useState<{ recebido_at: string; loja: string } | null>(null);
  const [confirmado, setConfirmado] = useState(false);

  const reset = () => {
    setOsNumero("");
    setLojaNome(lojaPadrao ?? "");
    setPreview(null);
    setJaRecebida(null);
    setConfirmado(false);
  };

  const handlePreview = async () => {
    if (!osNumero.trim()) {
      toast.error("Informe o número da OS");
      return;
    }
    setLoading(true);
    setPreview(null);
    setJaRecebida(null);
    try {
      const { data, error } = await supabase.functions.invoke("confirmar-recebimento-os", {
        body: { action: "preview", os_numero: osNumero.trim(), loja_nome: lojaNome.trim() || undefined },
      });
      if (error) throw error;
      if ((data as any)?.error) {
        toast.error(`OS não encontrada: ${(data as any).error}`);
        return;
      }
      setPreview((data as any).preview);
      if ((data as any).ja_recebida) setJaRecebida((data as any).ja_recebida);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao consultar OS");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview || !lojaNome.trim()) {
      toast.error("Informe a loja que está recebendo");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("confirmar-recebimento-os", {
        body: { action: "confirm", os_numero: preview.os_numero, loja_nome: lojaNome.trim() },
      });
      if (error) throw error;
      if ((data as any)?.error) {
        toast.error((data as any).error);
        return;
      }
      const status = (data as any).status;
      if (status === "already_received") {
        toast.info("OS já estava registrada como recebida.");
      } else {
        toast.success("Recebimento confirmado. Cliente avisado.");
      }
      setConfirmado(true);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao confirmar recebimento");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <PackageCheck className="w-4 h-4" />
            Receber OS
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar recebimento de OS</DialogTitle>
          <DialogDescription>
            Informe o número da OS e a loja para avisar o cliente que o pedido chegou.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="os">Número da OS</Label>
            <Input
              id="os"
              value={osNumero}
              onChange={(e) => setOsNumero(e.target.value)}
              placeholder="Ex.: 123456"
              disabled={loading || !!preview}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loja">Loja que está recebendo</Label>
            <Input
              id="loja"
              value={lojaNome}
              onChange={(e) => setLojaNome(e.target.value)}
              placeholder="Nome da loja"
              disabled={loading || confirmado}
            />
          </div>

          {!preview && (
            <Button onClick={handlePreview} disabled={loading} className="w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Consultar OS"}
            </Button>
          )}

          {preview && (
            <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-sm">
              <div><span className="text-muted-foreground">Cliente:</span> <b>{preview.cliente_nome ?? "—"}</b></div>
              <div><span className="text-muted-foreground">Loja da OS:</span> {preview.loja_nome_os ?? "—"}</div>
              <div><span className="text-muted-foreground">Etapa atual:</span> <Badge variant="secondary">{preview.etapa_label ?? preview.cod_etapa_atual ?? "?"}</Badge></div>
              {preview.produtos?.length > 0 && (
                <div>
                  <div className="text-muted-foreground">Produtos:</div>
                  <ul className="list-disc ml-5">
                    {preview.produtos.map((p, i) => (
                      <li key={i}>{typeof p === "string" ? p : (p.descricao ?? JSON.stringify(p))}</li>
                    ))}
                  </ul>
                </div>
              )}
              {jaRecebida && (
                <div className="flex items-start gap-2 text-amber-600">
                  <AlertTriangle className="w-4 h-4 mt-0.5" />
                  <span>Já registrada como recebida por <b>{jaRecebida.loja}</b>.</span>
                </div>
              )}
              {confirmado ? (
                <div className="flex items-center gap-2 text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" />
                  Recebimento registrado.
                </div>
              ) : (
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" onClick={() => { setPreview(null); setJaRecebida(null); }} disabled={loading}>
                    Voltar
                  </Button>
                  <Button onClick={handleConfirm} disabled={loading} className="flex-1">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar recebimento"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

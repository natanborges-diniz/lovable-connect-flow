import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PackageCheck, Loader2, AlertTriangle, CheckCircle2, Send, Check, CheckCheck, Eye, XCircle, CalendarCheck, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

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

type OsRow = {
  id: string;
  os_numero: string;
  loja_nome: string;
  cliente_nome: string | null;
  wa_status: string | null;
  wa_status_at: string | null;
  wa_status_reason: string | null;
  agendamento_id: string | null;
  notificado_cliente_at: string | null;
};

interface Props {
  lojaPadrao?: string | null;
  trigger?: React.ReactNode;
}

function StatusStep({
  active, done, icon: Icon, label, at,
}: { active: boolean; done: boolean; icon: any; label: string; at?: string | null }) {
  const color = done ? "text-emerald-600" : active ? "text-blue-600" : "text-muted-foreground/50";
  return (
    <div className={`flex items-center gap-2 ${color}`}>
      <Icon className="w-4 h-4" />
      <span className="text-xs">
        {label}
        {at && (done || active) && (
          <span className="ml-1 text-muted-foreground">
            · {formatDistanceToNow(new Date(at), { addSuffix: true, locale: ptBR })}
          </span>
        )}
      </span>
    </div>
  );
}

function RastreioPainel({ row, onResend, resending }: { row: OsRow; onResend: () => void; resending: boolean }) {
  const s = row.wa_status;
  const failed = s === "failed" || s === "no_dispatch";
  const sent = !!row.notificado_cliente_at || ["sent", "delivered", "read"].includes(s ?? "");
  const delivered = ["delivered", "read"].includes(s ?? "");
  const read = s === "read";
  const agendou = !!row.agendamento_id;

  return (
    <div className="rounded-md border bg-background p-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Rastreio ao cliente</div>

      {failed ? (
        <div className="flex items-start gap-2 text-red-600 text-sm">
          <XCircle className="w-4 h-4 mt-0.5" />
          <div>
            <div><b>Cliente NÃO foi avisado.</b></div>
            {row.wa_status_reason && <div className="text-xs mt-0.5">Motivo: {row.wa_status_reason}</div>}
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <StatusStep active={sent && !delivered} done={delivered || read} icon={Send} label="Enviado" at={row.notificado_cliente_at} />
          <StatusStep active={delivered && !read} done={read} icon={CheckCheck} label="Entregue no WhatsApp" at={delivered ? row.wa_status_at : null} />
          <StatusStep active={read && !agendou} done={read} icon={Eye} label="Lido pelo cliente" at={read ? row.wa_status_at : null} />
          <StatusStep active={false} done={agendou} icon={CalendarCheck} label={agendou ? "Cliente agendou retirada" : "Aguardando resposta"} />
        </div>
      )}

      {(failed || (sent && !read)) && (
        <Button size="sm" variant="outline" onClick={onResend} disabled={resending} className="w-full mt-1">
          {resending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          Reenviar aviso
        </Button>
      )}
    </div>
  );
}

export function ConfirmarRecebimentoOSDialog({ lojaPadrao, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [osNumero, setOsNumero] = useState("");
  const [lojaNome, setLojaNome] = useState(lojaPadrao ?? "");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [jaRecebida, setJaRecebida] = useState<{ recebido_at: string; loja: string } | null>(null);
  const [row, setRow] = useState<OsRow | null>(null);

  const reset = () => {
    setOsNumero(""); setLojaNome(lojaPadrao ?? "");
    setPreview(null); setJaRecebida(null); setRow(null);
  };

  // Realtime: acompanha updates de wa_status ao vivo
  useEffect(() => {
    if (!row?.id) return;
    const channel = supabase
      .channel(`os-rec-${row.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "os_recebimento_loja", filter: `id=eq.${row.id}` },
        (payload) => setRow((prev) => ({ ...(prev as OsRow), ...(payload.new as OsRow) })),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [row?.id]);

  const handlePreview = async () => {
    if (!osNumero.trim()) { toast.error("Informe o número da OS"); return; }
    setLoading(true); setPreview(null); setJaRecebida(null);
    try {
      const { data, error } = await supabase.functions.invoke("confirmar-recebimento-os", {
        body: { action: "preview", os_numero: osNumero.trim(), loja_nome: lojaNome.trim() || undefined },
      });
      if (error) throw error;
      if ((data as any)?.error) { toast.error(`OS não encontrada: ${(data as any).error}`); return; }
      setPreview((data as any).preview);
      if ((data as any).ja_recebida) setJaRecebida((data as any).ja_recebida);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao consultar OS");
    } finally { setLoading(false); }
  };

  const handleConfirm = async () => {
    if (!preview || !lojaNome.trim()) { toast.error("Informe a loja"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("confirmar-recebimento-os", {
        body: { action: "confirm", os_numero: preview.os_numero, loja_nome: lojaNome.trim() },
      });
      if (error) throw error;
      if ((data as any)?.error) { toast.error((data as any).error); return; }
      const status = (data as any).status;
      if (status === "already_received") toast.info("OS já registrada como recebida.");
      else toast.success("Recebimento confirmado.");
      setRow((data as any).row);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao confirmar recebimento");
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (!row) return;
    setResending(true);
    try {
      const { data, error } = await supabase.functions.invoke("confirmar-recebimento-os", {
        body: { action: "resend", os_numero: row.os_numero, loja_nome: row.loja_nome },
      });
      if (error) throw error;
      if ((data as any)?.error) { toast.error((data as any).error); return; }
      toast.success("Aviso reenviado.");
      setRow((data as any).row);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao reenviar");
    } finally { setResending(false); }
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
            <Input id="os" value={osNumero} onChange={(e) => setOsNumero(e.target.value)}
              placeholder="Ex.: 123456" disabled={loading || !!preview || !!row} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="loja">Loja que está recebendo</Label>
            <Input id="loja" value={lojaNome} onChange={(e) => setLojaNome(e.target.value)}
              placeholder="Nome da loja" disabled={loading || !!row} />
          </div>

          {!preview && !row && (
            <Button onClick={handlePreview} disabled={loading} className="w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Consultar OS"}
            </Button>
          )}

          {preview && !row && (
            <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-sm">
              <div><span className="text-muted-foreground">Cliente:</span> <b>{preview.cliente_nome ?? "—"}</b></div>
              <div><span className="text-muted-foreground">Loja da OS:</span> {preview.loja_nome_os ?? "—"}</div>
              <div><span className="text-muted-foreground">Etapa:</span> <Badge variant="secondary">{preview.etapa_label ?? preview.cod_etapa_atual ?? "?"}</Badge></div>
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
              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={() => { setPreview(null); setJaRecebida(null); }} disabled={loading}>
                  Voltar
                </Button>
                <Button onClick={handleConfirm} disabled={loading} className="flex-1">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar recebimento"}
                </Button>
              </div>
            </div>
          )}

          {row && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-600 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                Recebimento registrado — OS {row.os_numero}
              </div>
              <RastreioPainel row={row} onResend={handleResend} resending={resending} />
              <Button variant="outline" className="w-full" onClick={() => { setOpen(false); reset(); }}>
                Fechar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

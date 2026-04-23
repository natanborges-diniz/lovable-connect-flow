import { useEffect, useState } from "react";
import { BellRing, BellOff, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  disableWebPush,
  enableWebPush,
  getCurrentSubscription,
  getNotificationPermission,
  isInIframe,
  isPushSupported,
  sendTestPush,
} from "@/lib/webPush";

type Status = "loading" | "unsupported" | "iframe" | "denied" | "off" | "on";

export function PushNotificationsButton() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function refresh() {
    if (!isPushSupported()) return setStatus("unsupported");
    if (isInIframe()) return setStatus("iframe");
    const perm = await getNotificationPermission();
    if (perm === "denied") return setStatus("denied");
    const sub = await getCurrentSubscription();
    setStatus(sub ? "on" : "off");
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleEnable() {
    setBusy(true);
    const res = await enableWebPush();
    setBusy(false);
    if (res.ok === true) {
      toast({ title: "Notificações ativadas", description: "Você receberá pushes neste dispositivo." });
    } else {
      toast({ title: "Não foi possível ativar", description: res.reason, variant: "destructive" });
    }
    await refresh();
  }

  async function handleDisable() {
    setBusy(true);
    await disableWebPush();
    setBusy(false);
    toast({ title: "Notificações desativadas" });
    await refresh();
  }

  async function handleTest() {
    setBusy(true);
    const res = await sendTestPush();
    setBusy(false);
    toast({
      title: res.ok ? "Push enviado" : "Falhou",
      description: res.message,
      variant: res.ok ? "default" : "destructive",
    });
  }

  const Icon = status === "on" ? BellRing : BellOff;
  const tone = status === "on" ? "text-primary" : "text-muted-foreground";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Notificações push">
          <Icon className={`h-4 w-4 ${tone}`} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold">Notificações no dispositivo</p>
            <p className="text-xs text-muted-foreground">
              Receba avisos mesmo com a aba fechada.
            </p>
          </div>

          {status === "loading" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Verificando…
            </div>
          )}

          {status === "unsupported" && (
            <p className="text-xs text-destructive">Este navegador não suporta Web Push.</p>
          )}

          {status === "iframe" && (
            <p className="text-xs text-muted-foreground">
              Abra o app fora do preview (em uma aba do navegador) para ativar push.
            </p>
          )}

          {status === "denied" && (
            <p className="text-xs text-destructive">
              Permissão bloqueada. Libere notificações nas configurações do navegador e recarregue.
            </p>
          )}

          {status === "off" && (
            <Button size="sm" onClick={handleEnable} disabled={busy} className="w-full">
              {busy ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <BellRing className="h-3 w-3 mr-2" />}
              Ativar notificações
            </Button>
          )}

          {status === "on" && (
            <div className="space-y-2">
              <p className="text-xs text-emerald-600 font-medium">✓ Ativado neste dispositivo</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleTest} disabled={busy} className="flex-1">
                  <Send className="h-3 w-3 mr-1" /> Testar
                </Button>
                <Button size="sm" variant="ghost" onClick={handleDisable} disabled={busy} className="flex-1">
                  <BellOff className="h-3 w-3 mr-1" /> Desativar
                </Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

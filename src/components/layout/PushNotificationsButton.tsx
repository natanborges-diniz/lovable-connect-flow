import { useEffect, useState } from "react";
import { BellRing, BellOff, Loader2, Send, Smartphone, Share, Plus } from "lucide-react";
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
  isAndroid,
  isInIframe,
  isIOS,
  isPushSupported,
  isStandalone,
  iosSupportsWebPush,
  sendTestPush,
} from "@/lib/webPush";

type Status =
  | "loading"
  | "unsupported"
  | "iframe"
  | "ios-too-old"
  | "ios-needs-install"
  | "denied"
  | "off"
  | "on";

export function PushNotificationsButton() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function refresh() {
    if (isInIframe()) return setStatus("iframe");

    if (isIOS()) {
      if (!iosSupportsWebPush()) return setStatus("ios-too-old");
      if (!isStandalone()) return setStatus("ios-needs-install");
    }

    if (!isPushSupported()) return setStatus("unsupported");

    const perm = await getNotificationPermission();
    if (perm === "denied") return setStatus("denied");
    const sub = await getCurrentSubscription();
    setStatus(sub ? "on" : "off");
  }

  useEffect(() => {
    refresh();
    // Re-checa quando a aba volta ao foco (útil ao instalar PWA e abrir pelo ícone)
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
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
      <PopoverContent className="w-80 p-3" align="end">
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

          {status === "ios-too-old" && (
            <div className="space-y-2 rounded-md border border-amber-300/40 bg-amber-50/50 p-2 dark:bg-amber-950/30">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                <Smartphone className="h-3 w-3" /> iPhone precisa de iOS 16.4 ou superior
              </div>
              <p className="text-xs text-muted-foreground">
                Atualize seu iPhone em <strong>Ajustes → Geral → Atualização de Software</strong> e tente novamente.
              </p>
            </div>
          )}

          {status === "ios-needs-install" && (
            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
              <div className="flex items-center gap-2 text-xs font-medium text-primary">
                <Smartphone className="h-3 w-3" /> Instale o app no iPhone
              </div>
              <ol className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">1.</span>
                  <span>
                    Toque no ícone <Share className="inline h-3 w-3" /> <strong>Compartilhar</strong> na barra do Safari
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">2.</span>
                  <span>
                    Role e toque em <Plus className="inline h-3 w-3" /> <strong>Adicionar à Tela de Início</strong>
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">3.</span>
                  <span>Abra o app pelo ícone <strong>INFOCO</strong> na tela inicial</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-foreground">4.</span>
                  <span>Volte aqui e toque em "Ativar notificações"</span>
                </li>
              </ol>
            </div>
          )}

          {status === "denied" && (
            <p className="text-xs text-destructive">
              Permissão bloqueada. Libere notificações nas configurações do navegador e recarregue.
            </p>
          )}

          {status === "off" && (
            <>
              {isAndroid() && !isStandalone() && (
                <p className="text-[11px] text-muted-foreground -mb-1">
                  💡 No Android funciona direto. Instalar o app na tela inicial é opcional.
                </p>
              )}
              <Button size="sm" onClick={handleEnable} disabled={busy} className="w-full">
                {busy ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <BellRing className="h-3 w-3 mr-2" />}
                Ativar notificações
              </Button>
            </>
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

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">Como funciona em cada dispositivo</summary>
            <ul className="mt-2 space-y-1.5 pl-1">
              <li><strong>Android (Chrome/Edge):</strong> ativa direto, funciona com app fechado.</li>
              <li><strong>iPhone/iPad:</strong> precisa instalar como app na tela inicial (iOS 16.4+).</li>
              <li><strong>Desktop:</strong> ativa direto em Chrome, Edge, Firefox e Safari.</li>
            </ul>
          </details>
        </div>
      </PopoverContent>
    </Popover>
  );
}

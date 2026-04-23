// Helper de Web Push: registra Service Worker, pede permissão, cria PushSubscription
// e persiste em public.push_subscriptions.
import { supabase } from "@/integrations/supabase/client";

const SW_URL = "/sw.js";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

async function getVapidPublicKey(): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ publicKey: string }>(
    "get-vapid-public-key",
    { method: "GET" },
  );
  if (error) throw new Error(`Falha buscando VAPID public key: ${error.message}`);
  if (!data?.publicKey) throw new Error("VAPID public key vazia");
  return data.publicKey;
}

export async function registerSW(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) throw new Error("Service Worker não suportado");
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  return reg;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  return Notification.permission;
}

export async function enableWebPush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isPushSupported()) return { ok: false, reason: "Navegador não suporta Web Push" };
  if (isInIframe()) {
    return {
      ok: false,
      reason: "Abra o app fora do preview (em uma aba própria) para ativar notificações.",
    };
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, reason: "Faça login antes de ativar notificações." };

  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Permissão negada pelo navegador." };

  const reg = await registerSW();

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const publicKey = await getVapidPublicKey();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const endpoint = sub.endpoint;
  const p256dh = json.keys?.p256dh ?? arrayBufferToBase64(sub.getKey("p256dh")!);
  const auth = json.keys?.auth ?? arrayBufferToBase64(sub.getKey("auth")!);

  if (!endpoint || !p256dh || !auth) {
    return { ok: false, reason: "Falha ao gerar credenciais push." };
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: userData.user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );

  if (error) return { ok: false, reason: `Falha salvando subscription: ${error.message}` };

  return { ok: true };
}

export async function disableWebPush(): Promise<void> {
  const sub = await getCurrentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {}
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}

export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await supabase.functions.invoke("send-test-push", { method: "POST" });
  if (error) return { ok: false, message: error.message };
  const sent = (data as { sent?: number })?.sent ?? 0;
  return { ok: sent > 0, message: sent > 0 ? `Enviado para ${sent} dispositivo(s).` : "Nenhum dispositivo registrado." };
}

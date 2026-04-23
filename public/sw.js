// INFOCO OPS — Service Worker para Web Push
// Mantém escopo mínimo: receber push e abrir/focar a janela ao clicar.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "Notificação", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "INFOCO OPS";
  const options = {
    body: data.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
    renotify: !!data.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          const url = new URL(client.url);
          // Se já existe uma aba do app aberta, foca e navega
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client) client.navigate(targetUrl).catch(() => {});
            return;
          }
        } catch (_) {}
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    }),
  );
});

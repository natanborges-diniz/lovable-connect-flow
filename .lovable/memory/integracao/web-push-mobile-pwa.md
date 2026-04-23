---
name: Web Push Mobile (iOS + Android PWA)
description: Requisitos por plataforma para Web Push funcionar no celular — iOS exige standalone PWA + 16.4+, Android funciona direto no Chrome
type: feature
---

## Web Push no celular — INFOCO OPS

### Android (Chrome / Edge / Samsung Internet)
- Funciona **direto pelo navegador**, não precisa instalar.
- Endpoint emitido: `https://fcm.googleapis.com/...`.
- Notificação chega na barra mesmo com navegador fechado.
- Instalar como PWA é opcional (melhora UX, ícone na tela inicial).

### iOS / iPadOS (Safari)
- **Obrigatório** instalar como PWA na tela inicial (Compartilhar → Adicionar à Tela de Início).
- **Mínimo iOS 16.4** (lançado em março/2023).
- Endpoint emitido: `https://web.push.apple.com/...`.
- `Notification.requestPermission()` só funciona quando o app está rodando em modo `standalone`.
- Detectar com `window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`.
- iOS é estrito: `body` da notificação não pode ser vazio (mandar `" "` como fallback) e ícone precisa ser PNG (não `.ico`).

### Assets PWA do projeto
- `public/icons/icon-192.png` — Android home + favicon HD.
- `public/icons/icon-512.png` — splash/install Android e desktop.
- `public/icons/icon-512-maskable.png` — Android adaptive (purpose: maskable).
- `public/icons/apple-touch-icon-180.png` — ícone na tela inicial do iOS.
- `public/manifest.webmanifest` com `display: standalone`, `start_url: /`, `theme_color: #0b0f17`.
- `index.html` com `<link rel="apple-touch-icon">` e metas `apple-mobile-web-app-*`.

### Fluxo no botão `PushNotificationsButton`
1. Detecta `isIOS()`, `isAndroid()`, `isStandalone()`, `getIOSVersion()`.
2. Estados:
   - `ios-too-old` — iPhone < 16.4: pedir atualização do iPhone.
   - `ios-needs-install` — Safari iOS fora do standalone: passo-a-passo de "Adicionar à Tela de Início".
   - `iframe` — preview do Lovable: pedir abrir fora.
   - `unsupported`, `denied`, `off`, `on` — fluxo padrão.
3. No Android, `beforeinstallprompt` é capturado para oferecer botão "Instalar app" opcional, mas a ativação de push **não depende** disso.

### App nativo Atrium Messenger
- Continua usando `register-push-token` + `dispatch-push` (FCM/APNs) num projeto Lovable separado.
- Web Push aqui é complementar — quem usa o INFOCO OPS pelo navegador/PWA recebe pelos endpoints `web.push.apple.com` / `fcm.googleapis.com` via `send-push`.

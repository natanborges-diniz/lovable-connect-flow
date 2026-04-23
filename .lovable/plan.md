

## Push no celular — iPhone (PWA) e Android (PWA + nativo)

### Diagnóstico

**Hoje no projeto:**
- Service Worker, `webPush.ts`, `send-push`, `get-vapid-public-key` e botão na topbar já existem e funcionam.
- `manifest.webmanifest` está mínimo (só `favicon.ico`), sem ícones 192/512.
- `index.html` não tem `apple-touch-icon` nem metas `apple-mobile-web-app-*`.
- Existe também a Edge Function `register-push-token` + `dispatch-push` para o **app nativo Atrium Messenger** (FCM/APNs) — esse fluxo é independente e continua valendo para o app nativo separado.

**Por que não chega push hoje:**
- **iPhone**: Web Push no iOS só funciona se o site for instalado como **PWA na tela inicial** (Safari iOS 16.4+). Sem ícones reais no manifest, iOS não oferece "Adicionar à Tela de Início" corretamente.
- **Android**: Web Push funciona direto no Chrome **sem precisar instalar**, mas a experiência fica muito melhor instalado (notificação com ícone, app full-screen). Sem ícones 192/512 o Chrome não dispara o prompt de instalação ("Adicionar à tela inicial") automaticamente.

### O que será feito

#### 1. Tornar o app instalável (iOS + Android)

**Gerar ícones PWA** em `public/icons/`:
- `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` (Android adaptive)
- `apple-touch-icon-180.png` (iOS)
- Fundo `#0b0f17` com marca INFOCO centralizada.

**`public/manifest.webmanifest`** — completo:
```json
{
  "name": "INFOCO OPS",
  "short_name": "INFOCO",
  "description": "Plataforma de Comunicação e Operações",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0b0f17",
  "theme_color": "#0b0f17",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

**`index.html`** — adicionar no `<head>`:
```html
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="INFOCO" />
<meta name="mobile-web-app-capable" content="yes" />
```

#### 2. Botão de push com instruções por plataforma

Em `src/lib/webPush.ts` adicionar helpers:
- `isIOS()` — detecta iPhone/iPad via `userAgent` + `maxTouchPoints`.
- `isAndroid()` — detecta Android via `userAgent`.
- `isStandalone()` — `matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`.
- `getIOSVersion()` — extrai versão para alertar quem está em iOS < 16.4.

Em `PushNotificationsButton.tsx` adicionar estados:
- **`ios-needs-install`** (Safari iOS, fora do standalone): passo-a-passo
  > 1. Toque em **Compartilhar** ⬆️ na barra do Safari  
  > 2. Role e toque em **"Adicionar à Tela de Início"**  
  > 3. Abra o app pelo ícone INFOCO  
  > 4. Toque em "Ativar notificações"
- **`ios-too-old`** (iOS < 16.4): pede atualização do iPhone.
- **`android-can-install`** (Chrome Android, fora do standalone): mensagem opcional sugerindo instalação para experiência completa, mas com botão "Ativar notificações" funcionando do mesmo jeito.
- Capturar `beforeinstallprompt` no Android para oferecer botão **"Instalar app"** nativo do Chrome.

#### 3. Ajustes do Service Worker para iOS/Android

`public/sw.js`:
- Trocar fallback de ícone para PNG: `icon: "/icons/icon-192.png"`, `badge: "/icons/icon-192.png"` (iOS rejeita `.ico`).
- Garantir `body` não vazio (`body: data.body || " "`) — iOS descarta push silencioso.
- Adicionar `vibrate: [200, 100, 200]` para Android.

#### 4. Documentação no popover

Colapsável "Como funciona em cada dispositivo":
- **Android (Chrome/Edge)**: ativar direto. Funciona com app aberto, fechado ou tela bloqueada. Instalar é opcional mas recomendado.
- **iPhone/iPad (iOS 16.4+)**: precisa instalar como app na tela inicial. Sem isso, iOS bloqueia notificações web.
- **Desktop**: ativar direto em Chrome, Edge, Firefox, Safari.

#### 5. App nativo Atrium Messenger (FCM/APNs)

Sem mudanças neste loop — `register-push-token` e `dispatch-push` continuam servindo o app nativo separado. O fluxo Web Push aqui é complementar, para quem usa o INFOCO OPS pelo navegador/PWA.

### Critério de aceite

**Android (Chrome):**
- Abrir `https://atrium-link.lovable.app` → botão "Ativar notificações" funciona direto, sem instalar.
- Após ativar, registro aparece em `push_subscriptions` com endpoint `fcm.googleapis.com`.
- "Testar" → notificação chega na barra de notificações do Android com ícone INFOCO, mesmo com o navegador fechado.
- Se Chrome oferecer prompt de instalação, ícone INFOCO aparece corretamente na tela inicial.

**iPhone (Safari iOS 16.4+):**
- Abrir o link no Safari → menu Compartilhar mostra "Adicionar à Tela de Início" com ícone INFOCO real.
- Abrir o app pelo ícone → barra de status some (standalone), botão deixa de mostrar instrução de instalação.
- Tocar "Ativar" → iOS pede permissão → ao conceder, registro aparece em `push_subscriptions` com endpoint `web.push.apple.com`.
- "Testar" → notificação chega na tela bloqueada do iPhone.

**Fallback claro:**
- iPhone iOS < 16.4 → mensagem pedindo atualização.
- Safari iOS sem instalar → instruções passo-a-passo.
- Navegador não suportado → aviso explícito.

### Memória

Salvar `mem://integracao/web-push-mobile-pwa.md`: requisitos por plataforma (iOS exige standalone + 16.4+ + ícones PNG; Android funciona direto no Chrome; ambos usam o mesmo endpoint `send-push`).


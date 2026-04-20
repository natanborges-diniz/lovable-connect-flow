

## Objetivo
Entregar um **prompt completo, autossuficiente, pronto para colar em um novo projeto Lovable** que gera o app mobile "Atrium Messenger" — substituto interno do WhatsApp para lojas/colaboradores, integrado em tempo real à plataforma atual via Lovable Cloud (Supabase) compartilhado.

O entregável desta sessão é **um único artefato Markdown** (`/mnt/documents/prompt-atrium-messenger.md`) contendo o prompt — não há mudanças no projeto atual.

---

## O que o prompt vai cobrir

### 1. Identidade do projeto
- Nome: **Atrium Messenger**
- Stack: React + Vite + Tailwind + Capacitor (Android + iOS) + Lovable Cloud (mesma instância Supabase do projeto principal `atrium-link`).
- Distribuição: PWA instalável + builds nativos para Play Store / App Store.

### 2. Conexão com backend existente (reuso, não duplicação)
- Mesmas credenciais Supabase (URL + anon key) do projeto principal — **não cria backend novo**.
- Tabelas reutilizadas: `mensagens_internas`, `demandas_loja`, `demanda_mensagens`, `notificacoes`, `telefones_lojas`, `profiles`, `user_roles`, `bot_fluxos`, `bot_menu_opcoes`, `bot_sessoes`, `solicitacoes`, `solicitacao_anexos`, `agendamentos`, `whatsapp_templates`.
- Storage buckets reutilizados: `whatsapp-media` (anexos), `cpf-documentos`.
- Edge Functions chamadas (não recriadas): `bridge-mensageria`, `criar-demanda-loja`, `encerrar-demanda-loja`, `bot-lojas`, `responder-solicitacao`, `payment-webhook`, `send-whatsapp-template` (para casos legados).

### 3. Autenticação
- Login email/senha + Google OAuth contra o mesmo Supabase Auth.
- Convite obrigatório: usuário só entra se telefone bate com `telefones_lojas` (lojas/colaboradores) ou `profiles.ativo=true` (operadores).
- Após login, hidrata `profiles`, `user_roles` e identifica papel: **loja**, **colaborador**, **operador**, **admin**.

### 4. Funcionalidades do app (paridade WhatsApp + mais)
**Chat 1:1 e de grupo (interno corporativo)**
- Lista de conversas (espelho da tela `/mensagens` da web).
- Threads em tempo real via Supabase Realtime em `mensagens_internas`.
- Envio de texto, imagem, áudio (gravado), arquivo, localização.
- Indicadores: digitando, entregue, lida (atualiza `lida=true` ao abrir).
- Badge de não lidas global e por conversa.

**Bots e fluxos automatizados (substituem bot-lojas WhatsApp)**
- Tela "Atendimento" mostra menu hierárquico vindo de `bot_menu_opcoes` (filtra por `tipo_bot` do contato).
- Fluxos consumidos via `bot_fluxos.etapas`: link de pagamento, boleto, CPF, reembolso, falar com equipe, confirmar comparecimento.
- Sessão persistida em `bot_sessoes`. Anexos via `solicitacao_anexos` no bucket `whatsapp-media`.
- Protocolo sequencial `SOL-AAAA-NNNNN` exibido no card de confirmação.

**Demandas e operações controladas**
- Aba "Demandas" reflete `demandas_loja` da loja logada (RLS por `loja_nome`).
- Mensagens de demanda em `demanda_mensagens` com encaminhamento ao cliente final controlado pela plataforma (botão "Encaminhar para cliente" só visível a operadores).
- Confirmação de comparecimento de agendamento atualiza `agendamentos.loja_confirmou_presenca` direto (substitui opção 4 do bot WhatsApp).
- Envio de comprovante de pagamento (`payment-webhook` recebe e dispara fluxo Picote interno).

**Notificações push (FCM Android / APNs iOS)**
- Plugin Capacitor Push Notifications.
- Token salvo em `profiles.metadata.push_token`.
- Disparado por trigger Postgres (NEW row em `notificacoes`) → Edge Function nova `dispatch-push` → FCM/APNs.
- Tipos: nova mensagem, nova demanda, nova solicitação atribuída, lembrete de agendamento.

**Imagens e mídia (paridade total WhatsApp)**
- Picker nativo (Capacitor Camera) para foto/galeria.
- Compressão client-side antes do upload.
- Preview inline + visualizador full-screen.
- Anexos guardados em `whatsapp-media/{ano}/{mes}/{conversa_id}/{uuid}`.
- Áudio: gravação via `@capacitor-community/voice-recorder`, WAV → upload, player inline.

**Receitas (continuidade do fluxo óptico)**
- Loja envia foto da receita → trigger chama Edge Function `interpretar-receita` (já existe) → retorna OD/OE/Add → grava em `contatos.metadata.receitas[]`.
- Card visual com a receita parsed, botão "Compartilhar com cliente".

### 5. Arquitetura mobile
- Capacitor 6 com plugins: Camera, Filesystem, PushNotifications, Geolocation, VoiceRecorder, LocalNotifications, Network (offline detection), App (deep links).
- Service Worker (Workbox) para cache offline das últimas 50 conversas.
- IndexedDB (Dexie) para fila de envios offline; sync quando voltar online.
- Realtime: 1 canal global `notificacoes-{user_id}` + canais sob demanda por conversa.
- Padrão obrigatório: registrar `.on()` antes de `.subscribe()` (memória `arquitetura/padrao-realtime-subscription`).

### 6. UI/UX
- Tema escuro/claro.
- Bottom tab nav: **Conversas | Demandas | Atendimento | Notificações | Perfil**.
- Estilo iMessage/WhatsApp: bolhas, avatar, swipe-to-reply, long-press menu, busca global.
- Suporte a modo loja (vê só sua loja) vs modo operador (vê tudo do setor).
- Componentes shadcn/ui adaptados para mobile (sheet, drawer, toast nativo).

### 7. Segurança e RBAC
- RLS já existente em `mensagens_internas`, `notificacoes`, `demandas_loja` é o que protege.
- Cliente nunca recebe service role key.
- App usa `@supabase/supabase-js` com anon key (já public).
- Validações zod em todo input (nome, telefone, mensagem ≤ 4000 chars).
- HIBP password check ativo no Auth.

### 8. Substituição do WhatsApp — fluxo de migração
- Convite via SMS único contendo deep link `atrium://invite?token=...`.
- Onboarding força associação telefone↔conta.
- Após adoção pela loja, o backend principal **deixa de enviar via Meta** para esse contato e marca `telefones_lojas.metadata.canal_preferido = 'app'`.
- Fallback automático: se app não confirmou recebimento em 5 min, dispara WhatsApp template (mantém continuidade durante rollout).

### 9. Edge Function nova exigida (do lado do projeto principal, fora do escopo do app)
- `dispatch-push` (push para tokens FCM/APNs). O prompt **lista** isso como dependência mas o app em si só consome.

### 10. O que NÃO está no escopo do app
- Pipelines Kanban (CRM, Lojas, Financeiro) → continuam só na web.
- Configurações administrativas (cron, templates, RBAC) → continuam só na web.
- IA Gael conversacional do CRM → app só exibe mensagens já geradas.

---

## Estrutura do prompt entregue
O arquivo `prompt-atrium-messenger.md` terá estas seções, prontas para colar:
1. Visão e objetivo
2. Stack obrigatória + versões
3. Credenciais Lovable Cloud (placeholders para o usuário preencher: SUPABASE_URL, ANON_KEY)
4. Schema reutilizado (lista de tabelas + RLS observada)
5. Telas (lista detalhada com componentes e comportamentos)
6. Fluxos críticos passo a passo (login, enviar mensagem, receber push, abrir demanda, confirmar agendamento, enviar receita)
7. Padrões de código obrigatórios (Realtime subscribe order, zod, debounce, error toasts)
8. Capacitor setup completo (appId, appName, plugins, comandos `cap add`, `cap sync`)
9. Roadmap de entrega em 5 sprints
10. Critérios de aceite por funcionalidade

Tamanho alvo: 6-8 mil caracteres, copiar-e-colar único.

---

## Entregável final desta sessão
- Um único arquivo: `/mnt/documents/prompt-atrium-messenger.md`
- Tag `<lov-artifact>` para download direto.
- Nenhuma mudança no projeto atual (`atrium-link`).


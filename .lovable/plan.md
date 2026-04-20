

## Próximos passos — Canal Único + App Atrium

Banners ficam de fora (combinado). Foco agora em **destravar a operação real** e **preparar o terreno para o app**.

---

## Etapa 1 — Templates Meta (URGENTE, bloqueador)
Sem template aprovado, **nenhum cron de cliente final dispara fora da janela 24h**. Hoje há 0 templates aprovados.

Criar e submeter para Meta os 5 templates mínimos via `WhatsAppTemplatesCard` (já existe UI):

| Nome | Categoria | Função-alvo | Variáveis |
|---|---|---|---|
| `confirmacao_agendamento` | UTILITY | `agendamentos-cron` (confirmação) | nome, loja, data, hora |
| `lembrete_agendamento_24h` | UTILITY | `agendamentos-cron` (lembrete) | nome, loja, data, hora |
| `noshow_recuperacao` | UTILITY | `agendamentos-cron` (no-show) | nome, loja |
| `recuperacao_inatividade_crm` | MARKETING | `vendas-recuperacao-cron` | nome |
| `retomada_atendimento` | UTILITY | `recuperar-atendimentos` | nome |

Cada um já tem gate no código (`send-whatsapp-template` + verificação 24h em `send-whatsapp`). Submissão é via UI → Meta aprova em ~24-48h.

## Etapa 2 — Atualizar memória Core
Refletir o modelo definitivo no `mem://index.md`:
- Substituir linha "WhatsApp: Dual-Number routing..." por: **"WhatsApp = somente Meta Official para clientes finais. B2B/interno (lojas, colaboradores, setores) = App Atrium Messenger via `mensagens_internas` + `notificacoes` + push."**
- Adicionar referência: `[Canal Único Meta + App Atrium](mem://arquitetura/canal-unico-meta-e-app-atrium)`.
- Marcar como deprecated (header de aviso, sem deletar): `mem://funcionalidades/integracao-whatsapp-dual-number`, `mem://projeto/estrategia-migracao-whatsapp-progressiva`, `mem://arquitetura/modelo-channel-bridge`, `mem://bot-lojas/demandas-b2b-canal-evolution`, `mem://integracao/evolution-api-decodificacao-media`.

## Etapa 3 — Preparar `profiles` para push tokens (app)
O app Atrium vai registrar token FCM/APNs por usuário. Hoje `profiles` não tem coluna `metadata`.

Migration:
- `ALTER TABLE profiles ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;`
- Index parcial: `CREATE INDEX idx_profiles_push_token ON profiles ((metadata->>'push_token')) WHERE metadata ? 'push_token';`
- Atualizar `dispatch-push/index.ts` para ler `profiles.metadata.push_token` (hoje só loga "skipped_no_token").

## Etapa 4 — Adicionar fluxo "registrar push token" no app (handshake)
Edge Function nova `register-push-token` (chamada pelo app no login):
- Body: `{ token: string, platform: 'ios'|'android' }`
- Valida JWT do usuário, faz `update profiles set metadata = metadata || {push_token, push_platform, push_registered_at}`.
- CORS habilitado.

## Etapa 5 — Verificação end-to-end (manual, depois das etapas 1–4)
1. Criar demanda de loja na web → confirmar registro em `mensagens_internas` + `notificacoes` (sem WhatsApp).
2. Aprovar 1º template Meta → testar disparo via `agendamentos-cron` para um cliente real.
3. Quando o app Atrium subir o primeiro build, registrar token, disparar uma `notificacao` e validar push (ou log-only).

---

## Arquivos
**Edits**
- `mem://index.md` (atualizar Core + adicionar referência)
- `supabase/functions/dispatch-push/index.ts` (ler `metadata.push_token`)

**Create**
- Migration: `ALTER TABLE profiles ADD COLUMN metadata jsonb` + index parcial
- `supabase/functions/register-push-token/index.ts`
- `supabase/config.toml` — bloco `[functions.register-push-token] verify_jwt = true`
- 5 headers "deprecated" nos 5 arquivos de memória listados

**Não incluso**
- Banners visuais (descartado)
- Submissão real dos templates à Meta (manual via UI; só prepara o catálogo)
- Build do app Atrium (projeto separado)
- Configuração de FCM/APNs (entra quando o app estiver pronto, via `add_secret`)

## Ordem sugerida de execução
1. **Etapa 1** primeiro (templates) — destrava operação imediatamente.
2. **Etapas 3 + 4** em sequência (banco + edge function) — destrava integração com o app.
3. **Etapa 2** (memória) — fecha a documentação.
4. **Etapa 5** (testes) — só depois das 3 anteriores.


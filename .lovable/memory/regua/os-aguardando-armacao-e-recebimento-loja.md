---
name: Régua OS — aguardando armação + recebimento loja (FLUXOS SEPARADOS)
description: Fluxo 1 (aguardando armação) só dispara aviso ao cliente + agendamento via IA — log em os_avisos_armacao_log. Fluxo 2 (OS pronta na loja) é manual pela loja via EF confirmar-recebimento-os com action=preview|confirm|resend. Rastreio realtime (sent/delivered/read/failed + agendou) exibido no dialog após confirmar.
type: feature
---

## Dois fluxos independentes, duas tabelas

### Fluxo 1 — Aguardando armação (codEtapa=15)
- Cron `regua-disparo-aguardando-armacao` 07:00 SP; domingo pula; segunda processa D-1+D-2.
- Bridge `GET /api/v1/os/movimentadas?data=D-1&codEtapa=15` → template `aviso_aguardando_armacao`.
- Persiste em `os_avisos_armacao_log` (idempotência). **Não** grava em `os_recebimento_loja`.

### Fluxo 2 — OS pronta na loja (manual)
- Loja digita OS no Atrium via `ConfirmarRecebimentoOSDialog`.
- EF `confirmar-recebimento-os` (verify_jwt=true) — três modos:
  - `preview`: consulta bridge; não grava.
  - `confirm` (default): upsert + dispara `os_recebida_loja` ao cliente.
  - `resend`: reenvia template para linha existente (falha ou sem leitura).
- Idempotente. Já recebida → `already_received`.

## Rastreio ao cliente (evidência da loja)

Após `confirm`, o dialog **não fecha** — mostra o painel `RastreioPainel` com:
- ⏱️ Enviado → ✅ Entregue → 👁️ Lido → 📅 Agendou retirada (ou ❌ Falhou + motivo).
- Fonte: `os_recebimento_loja.wa_status | wa_status_at | wa_status_reason | agendamento_id | notificado_cliente_at`.
- Atualização via Realtime (`postgres_changes UPDATE filter=id=eq.<row.id>`) — tabela está no `supabase_realtime` publication com `REPLICA IDENTITY FULL`.
- Botão **Reenviar aviso** aparece se `failed`/`no_dispatch` ou se `sent` sem `read`.

### Estados de `wa_status`
- `sent` — Meta aceitou (`send-whatsapp-template` retornou `status=sent`; wamid salvo).
- `delivered` / `read` — webhook Meta.
- `failed` — Meta rejeitou; motivo em `wa_status_reason`.
- `no_dispatch` — não disparou (sem `contato_id`, sem telefone da bridge, etc); motivo em `wa_status_reason`. Evita a falha silenciosa (caso Carolina/OS 99369).

## Gate "loja obrigatória" (ai-triage)

Une `os_avisos_armacao_log` (30d) e `os_recebimento_loja` (30d, sem agendamento). Injeta bloco no prompt. `agendar-cliente` linka `agendamento_id` no Fluxo 2.

## Templates (APROVADOS)

- `os_recebida_loja_v2` / alias `os_recebida_loja` — params `{nome, os_numero, loja}`.
- `aviso_aguardando_armacao_v2` / alias `aviso_aguardando_armacao` — mesmos params.

## RLS

- `os_avisos_armacao_log`: SELECT admin/operador. Service role grava.
- `os_recebimento_loja`: admin/operador tudo; `tipo_usuario='loja'` só suas `user_acessos.lojas[]`.

## UI

`src/components/os/ConfirmarRecebimentoOSDialog.tsx` — visível para `isAdmin || acessos.acessoTotal || acessos.modulos.menu_loja`.

## Branding

"Óticas Diniz" (cliente nunca vê "Atrium").

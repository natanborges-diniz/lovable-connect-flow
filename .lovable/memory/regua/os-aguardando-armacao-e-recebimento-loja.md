---
name: Régua OS — aguardando armação + recebimento loja
description: Tabela os_recebimento_loja rastreia dois fluxos: cron 07:00 SP avisa cliente quando OS entrou em codEtapa=15 (D-1) e loja confirma manualmente recebimento via EF confirmar-recebimento-os
type: feature
---

## Dois fluxos, uma tabela: `os_recebimento_loja`

Tabela única com PK `(os_numero, loja_nome)` rastreando ambos:

**Fluxo 1 — aviso D+1 "traga a armação" (codEtapa=15)**
- Cron `regua-disparo-aguardando-armacao` roda 07:00 SP (`0 10 * * *` UTC, registrado em `cron_jobs` + pg_cron).
- Consulta bridge Firebird: `GET {BRIDGE_URL}/api/v1/os/movimentadas?data=D-1&codEtapa=15` com header `x-service-key: INTERNAL_SERVICE_SECRET`.
- Dedup por `(os, loja)` — bridge devolve linha por entrada em `ordemservicocaixalog`.
- Resolve `loja_nome` via `telefones_lojas.cod_empresa` → `nome_loja` (fallback: `r.empresa`).
- Resolve `contato_id` por `telefone` (digits-only).
- Upsert na tabela e, se contato resolvido, dispara `send-whatsapp-template` com alias `aviso_aguardando_armacao` (params: `[primeiro_nome, os_numero, loja_nome]`).
- Idempotente: pula se `aviso_armacao_enviado_at IS NOT NULL`.

**Fluxo 2 — recebimento manual no Atrium Messenger**
- EF `confirmar-recebimento-os` (verify_jwt=true) recebe `{os_numero, loja_nome}` do usuário-loja.
- Se não houver linha, consulta bridge `/api/v1/os/consulta-status?os=...` para popular cliente/telefone.
- Marca `recebido_at` + `recebido_por = auth.uid()`, dispara alias `os_recebida_loja` ao cliente.
- Idempotente: já recebida → retorna `already_received` sem reenviar.

## Templates (rascunho — aguardando aprovação Meta)

- `os_recebida_loja_v2` (UTILITY, pt_BR, PENDING) — "óculos pronto para retirada". Params `{nome, os_numero, loja}`. Alias `os_recebida_loja` → `_v2`.
- `aviso_aguardando_armacao_v2` (UTILITY, pt_BR, PENDING) — "lentes chegaram, escolha armação e quer agendar?". Params `{nome, os_numero, loja}`. Alias `aviso_aguardando_armacao` → `_v2`.

Catálogo em `whatsapp_templates`; gate em `send-whatsapp-template` bloqueia disparo enquanto `status != 'approved'`. Aliases permitem repointar sem redeploy.

### Calendário do cron `regua-disparo-aguardando-armacao`
- **Domingo SP** → execução pulada (retorna `skipped: "domingo"`).
- **Segunda SP** → processa D-1 (domingo) **+** D-2 (sábado), para cobrir o domingo que não rodou.
- **Demais dias** → processa apenas D-1.
- Override manual via body: `{data: "YYYY-MM-DD"}` ou `{datas: ["YYYY-MM-DD", ...]}`.

## RLS `os_recebimento_loja`

- Admin/operador: tudo.
- `user_acessos`: loja só vê/atualiza registros das próprias `lojas[]` (ou `acesso_total`).

## UI Messenger

Lista cards de `os_recebimento_loja WHERE recebido_at IS NULL` filtrados pela loja do usuário. Implementação no projeto cross-project **InFoco Messenger** (rota `/os-para-receber`) — fora do escopo do Atrium.

## Branding

Templates assinam "Óticas Diniz" (cliente final NUNCA vê "Atrium").

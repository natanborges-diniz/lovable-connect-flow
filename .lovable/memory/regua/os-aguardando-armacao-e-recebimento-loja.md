---
name: Régua OS — aguardando armação + recebimento loja (FLUXOS SEPARADOS)
description: Fluxo 1 (aguardando armação) só dispara aviso ao cliente + agendamento via IA — log em os_avisos_armacao_log. Fluxo 2 (OS pronta na loja) é manual pela loja via EF confirmar-recebimento-os com action=preview|confirm. Tabelas separadas; nenhuma sobreposição.
type: feature
---

## Dois fluxos independentes, duas tabelas

### Fluxo 1 — Aguardando armação (codEtapa=15)
**Objetivo:** avisar o CLIENTE que a lente chegou e ele precisa trazer a armação.
**Loja não recebe nada físico** — só verá o agendamento criado pela IA (via `notificar-loja-agendamento`).

- Cron `regua-disparo-aguardando-armacao` roda 07:00 SP (`0 10 * * *` UTC).
  - **Domingo** → pulado.
  - **Segunda** → processa D-1 (domingo) + D-2 (sábado).
  - **Demais dias** → D-1.
- Consulta bridge: `GET {BRIDGE_URL}/api/v1/os/movimentadas?data=D-1&codEtapa=15`.
- Resolve `loja_nome` via `telefones_lojas.cod_empresa` (fallback `r.empresa`) e `contato_id` por `telefone`.
- Dispara `send-whatsapp-template` alias `aviso_aguardando_armacao` → cliente.
- Persiste UMA linha em **`os_avisos_armacao_log`** (PK lógica `(os_numero, loja_nome)` via UNIQUE INDEX) — usada SÓ para idempotência. Não tem UI, não tem painel.
- **NUNCA grava em `os_recebimento_loja`.**

### Fluxo 2 — OS pronta na loja (manual)
**Objetivo:** loja recebe a OS montada vinda do lab e confirma → cliente é avisado que pode retirar.

- **Sem cron.** A loja digita o número da OS no Atrium Messenger.
- EF `confirmar-recebimento-os` (verify_jwt=true) — DOIS modos:
  - **`action: "preview"`** (body `{action:"preview", os_numero, loja_nome?}`): consulta bridge `/api/v1/os/consulta-status?os=...`, devolve `{cliente_nome, cliente_telefone, loja_nome_os, cod_empresa, cod_etapa_atual, etapa_label, produtos}` + flag `loja_confere` + `ja_recebida`. NÃO grava.
  - **`action: "confirm"`** (default, body `{os_numero, loja_nome}`): upsert em `os_recebimento_loja` com `recebido_at` + `recebido_por`, dispara alias `os_recebida_loja` ao cliente.
- Idempotente: já recebida → retorna `already_received` sem reenviar.
- Tabela **`os_recebimento_loja`** é exclusiva deste fluxo agora (colunas `aviso_armacao_*` e `cod_etapa_atual` ficam ociosas — herança histórica).

## Gate "loja obrigatória" (ai-triage)

Cliente que respondeu a qualquer dos dois templates pedindo agendar → IA força loja da OS, **proibido** oferecer outra unidade.

Query em `ai-triage` (linha ~5131) une as duas fontes:
- `os_avisos_armacao_log WHERE contato_id=? AND enviado_at >= now()-30d` (Fluxo 1).
- `os_recebimento_loja WHERE contato_id=? AND agendamento_id IS NULL AND notificado_cliente_at >= now()-30d` (Fluxo 2).

Injeta bloco `# OS RECENTES DESTE CLIENTE (loja OBRIGATÓRIA se agendar)` no prompt.

`agendar-cliente` faz o link em `os_recebimento_loja.agendamento_id` quando há match em mesma loja (Fluxo 2 sai do gate ao agendar). Fluxo 1 não tem coluna de link — gate expira por tempo (30d) ou desuso.

## Templates (rascunho — aguardando aprovação Meta)

- `os_recebida_loja_v2` (UTILITY, pt_BR, PENDING) — params `{nome, os_numero, loja}`. Alias `os_recebida_loja`.
- `aviso_aguardando_armacao_v2` (UTILITY, pt_BR, PENDING) — params `{nome, os_numero, loja}`. Alias `aviso_aguardando_armacao`.

Gate em `send-whatsapp-template` bloqueia disparo enquanto `status != 'approved'`.

## RLS

- `os_avisos_armacao_log`: SELECT só admin/operador (`has_role`). Service role grava.
- `os_recebimento_loja`: admin/operador tudo; usuário `tipo_usuario='loja'` vê/atualiza só linhas das próprias `user_acessos.lojas[]`.

## UI Atrium Messenger (cross-project)

Tela "Recebimento de OS" — Fluxo 2 only:
- Input "Número da OS" → chama `confirmar-recebimento-os` `action=preview`.
- Exibe dados retornados (cliente, loja, produto, etapa) + alerta se `loja_confere=false`.
- Botão "Confirmar recebimento" → chama `action=confirm` → dispara template.
- Histórico opcional: `SELECT * FROM os_recebimento_loja WHERE recebido_at IS NOT NULL` últimos 30d filtrado por `user_acessos.lojas[]`.

## Branding

Templates assinam "Óticas Diniz" (cliente final NUNCA vê "Atrium").

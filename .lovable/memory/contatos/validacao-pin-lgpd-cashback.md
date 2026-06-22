---
name: Validação de telefone via PIN + LGPD no cashback
description: No lançamento da venda do cashback, gera PIN 4 dígitos em regua_inscricao, envia template cashback_pin_validacao, consultor confirma no balcão; aceite registra termos LGPD e marca canais.status='validado'.
type: feature
---

## Fluxo

1. Loja lança a venda em `/regua/nova-venda` → cria `regua_inscricao` via RPC `regua_registrar_venda`.
2. Frontend abre `CashbackPinDialog` automaticamente → chama `cashback-loja` `action: gerar_pin`.
3. Edge function gera PIN aleatório de 4 dígitos, grava `pin_hash` (sha256 com salt = inscricao_id), `pin_expira_at = now()+15min`, `pin_tentativas = 0`.
4. Dispara alias `cashback_pin_validacao` → template real **`cashback_pin_otp`** (categoria **AUTHENTICATION**, aprovado Meta). `send-whatsapp-template` detecta `categoria='AUTHENTICATION'` e monta body + botão `COPY_CODE` com o PIN (param[0]). Nome/link de termos não viajam no template OTP (regra Meta) — a página `/termos/cashback?ins=<id>` continua acessível como referência auditável.
5. Cliente passa PIN ao consultor; consultor digita no dialog → `action: confirmar_pin`.
6. Em sucesso, grava em `regua_inscricao`: `pin_confirmado_at`, `consentimento_status='aceito'`, `consentimento_at=now()`, `canal_consentimento='pin_whatsapp'`, `termos_versao='v1-2026-06'`, `ip_origem_consultor`.
7. Chama RPC `canal_registrar_evento(_evento='validado')` → marca `canais.status='validado'` para aquele telefone + atualiza `validado_at`, `canal_consentimento`, `termos_versao`.
8. Loga em `eventos_crm` tipo `cashback_pin_confirmado`.

## Regras

- **3 tentativas** no PIN; após isso, motivo `tentativas_excedidas` (HTTP 429). Consultor precisa Reenviar (gera novo PIN, reseta contador).
- **15 min** de validade; motivo `pin_expirado` (HTTP 410).
- Já confirmado → idempotente, retorna `ja_confirmado`.
- `action: registrar` (resgate de cashback) NÃO foi atrelada ao PIN porque opera em fluxo balcão diferente (não-régua); manter como está.
- Aceite material = digitar o PIN. Página `/termos/cashback` é apenas exibição auditável da versão vigente — sem checkbox extra.

## Botão "NÃO FUI EU"

O mesmo template instrui responder `NÃO FUI EU`. `whatsapp-webhook` (ramo `0y`) detecta:
- `interactiveReply.id === 'nao_fui_eu'` (futuro botão quick-reply)
- ou texto livre `não fui eu` / `nao fui eu`

→ chama `canal_registrar_evento(_evento='pessoa_errada')` que marca `canais.status='pessoa_errada'`, e o webhook **retorna imediatamente** sem repassar ao fluxo IA/atendimento.

## Botão "SIM, SOU EU"

`interactiveReply.id === 'sim_sou_eu'` → valida canal sem PIN (consentimento via botão). Não bloqueia o fluxo normal.

## Schema

`regua_inscricao` ganhou: `pin_hash text, pin_expira_at timestamptz, pin_tentativas smallint, pin_confirmado_at timestamptz, termos_versao text, ip_origem_consultor inet`.

## Arquivos-chave

- `supabase/functions/cashback-loja/index.ts` — actions `gerar_pin`, `confirmar_pin`, `reenviar_pin`.
- `src/components/cashback/CashbackPinDialog.tsx` — dialog 4-OTP + countdown + reenviar.
- `src/pages/ReguaNovaVenda.tsx` — abre dialog após cadastrar venda.
- `src/pages/TermosCashback.tsx` — página pública `/termos/cashback`.
- Template `cashback_pin_validacao` em `whatsapp_templates` (status `rascunho` até aprovação Meta).

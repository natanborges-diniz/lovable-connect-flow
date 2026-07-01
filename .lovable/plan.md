# Boas-vindas cashback pós-PIN (texto livre) + trilha jurídica LGPD

## Por que sem template

O `cashback_pin_otp` (AUTHENTICATION) já abre a janela de 24h. Assim que o cliente confirma o PIN com a loja, estamos dentro da janela — mandamos **texto livre** direto pela API da Meta, sem template MARKETING nem submissão à Meta. Se a janela tiver estourado (cliente demorou muito), o envio falha em silêncio (só warn) e não invalida a confirmação.

## 1. Mensagem de boas-vindas (texto livre)

Disparada pela EF `cashback-loja` no fim da action `confirmar_pin`, logo depois de gravar o consentimento:

```
Olá, {primeiro_nome} 👋

Sua compra na {loja_nome} te garantiu um cashback exclusivo de R$ {valor_cashback}! 🎁

📅 Válido de {valido_de} até {valido_ate}
🛒 Na próxima compra a partir de R$ {minimo}

✅ Use pelo WhatsApp — é só me responder aqui.

⚡ Regras completas: https://atrium-link.lovable.app/termos/cashback
```

Parâmetros calculados na EF:
- `primeiro_nome` — primeiro token de `contatos.nome`
- `loja_nome` — `regua_inscricao.loja_nome`
- `valor_cashback` — pt-BR
- `valido_de` — `cashback_credito.disponivel_em` (dd/mm) — data em que o crédito passa a ser usável (regra D+N do programa)
- `valido_ate` — `cashback_credito.expira_em` (dd/mm)
- `minimo` — `valor_cashback × cashback_config.fator_resgate`

Se `disponivel_em <= hoje`, trocar a linha por `📅 Disponível agora, válido até {valido_ate}` para não confundir o cliente.

Envio: helper de texto livre já usado no projeto (`send-whatsapp-media` com `type: "text"` ou equivalente). Loga em `mensagens` (direção `saida`, tipo `texto`) para aparecer na thread e no Cliente 360, e em `eventos_crm` tipo `cashback_boas_vindas_enviado`. Falha só gera warn.

## 2. Consentimento de marketing explícito nos termos

- Bump `TERMOS_VERSAO` para `v2-2026-07` em `TermosCashback.tsx` e `cashback-loja/index.ts`.
- Reescrever seção "3. Comunicações" deixando claro que o aceite via PIN autoriza **mensagens transacionais E de marketing** do programa (saldo, vencimento, ofertas), com opt-out por `SAIR`.

## 3. Onde fica a trilha jurídica (resposta à pergunta anterior)

Toda evidência de aceite fica em **duas tabelas** e uma página versionada — auditável a qualquer momento:

**`regua_inscricao`** — uma linha por venda/aceite:
- `pin_confirmado_at` — timestamp exato do aceite
- `consentimento_status = 'aceito'`, `consentimento_at`
- `canal_consentimento = 'pin_whatsapp'`
- `termos_versao` (ex. `v1-2026-06` / `v2-2026-07`)
- `ip_origem_consultor` — IP do consultor que digitou o PIN
- `whatsapp`, `contato_id`, `loja_id`, `valor_venda`, `valor_cashback`

**`canais`** — estado atual do telefone:
- `status = 'validado'`, `validado_at`, `canal_consentimento`, `termos_versao`

**`eventos_crm`** (append-only) — trilha de auditoria: `tipo = 'cashback_pin_confirmado'` com `metadata { inscricao_id, termos_versao, ip }`.

**Página `/termos/cashback?ins=<id>`** — versão pública e datada; cada versão fica congelada no código sob a chave `TERMOS_VERSAO`, permitindo reconstruir o texto exato aceito naquele momento.

Para responder a solicitação do titular ou auditoria: `canais.telefone` → `regua_inscricao` → `eventos_crm` → render de `/termos/cashback` na versão registrada.

Retenção: mínimo 5 anos por analogia ao art. 27 CDC. Nada é apagado por cron.

## 4. Arquivos

- `supabase/functions/cashback-loja/index.ts` — no fim de `confirmar_pin`: busca dados, envia texto livre com `valido_de`/`valido_ate`/`minimo`, loga em `mensagens` e `eventos_crm`. Bump `TERMOS_VERSAO`.
- `src/pages/TermosCashback.tsx` — versão v2 com marketing explícito.
- Sem migration, sem template Meta.

## Fora de escopo

- `CashbackPinDialog.tsx` e template `cashback_pin_otp` permanecem intactos.

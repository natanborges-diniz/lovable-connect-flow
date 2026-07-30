# Pix automático (BTG) — contrato Atrium ↔ Optical Business e ativação

Fluxo fechado de cobrança Pix, espelhando o link de pagamento cartão. **Os dois lados já estão implementados**: Atrium/InFoco (este repo + desktop-joy-app) e Optical Business (tica-diniz-insights). Este documento registra o contrato entre os projetos e o checklist de ativação.

## Visão geral do fluxo

A loja abre "Gerar Pix (QR Code)" no InFoco Messenger e informa valor, descrição, cliente e WhatsApp. O Atrium (`criar-solicitacao-loja`) chama o `pix-charges` do OB, que cria uma cobrança Pix dinâmica (instant collection) no BTG e devolve QR Code + copia-e-cola + página hospedada. A loja vê o QR na tela e o cliente recebe o link por WhatsApp. Quando alguém paga, o BTG notifica o `btg-webhook` do OB (com polling de 30 min como rede de segurança e verificação on-demand enquanto a página `/pix/:id` está aberta), o OB confirma e repassa ao `payment-webhook` do Atrium, e a loja recebe o comprovante (TXID/E2E/pagador) automaticamente no Messenger — sem passar pelo Financeiro.

## 1) Endpoint no OB: `POST /functions/v1/pix-charges`

Implementado em `tica-diniz-insights/supabase/functions/pix-charges/index.ts`. Autenticação: `x-service-key` = `INTERNAL_SERVICE_SECRET` (mesmo segredo do `payment-links`) ou JWT de usuário OB.

### Request (action "criar") — o que o Atrium envia

```json
{
  "action": "criar",
  "cod_empresa": "123",
  "valor": "150.00",
  "descricao": "Lente Transition CR39",
  "cliente_nome": "Maria Silva",
  "expiracao_segundos": 86400,
  "origem": "ATRIUM_INFOCO",
  "origem_ref": "<uuid do usuário solicitante>"
}
```

### Response (HTTP 200)

```json
{
  "id": "<uuid payment_links>",
  "txid": "<txid BTG>",
  "pix_copia_cola": "00020126...6304ABCD",
  "qr_code_base64": "data:image/svg+xml;base64,...",
  "url_pagamento": "https://lens-data-vision.lovable.app/pix/<id>",
  "status": "ATIVO",
  "expira_em": "2026-07-30T12:00:00Z",
  "valor": 150.00,
  "descricao": "Lente Transition CR39"
}
```

A cobrança é persistida na tabela `payment_links` do OB com `adquirente='PIX_BTG'` (`qr_code_pix` = copia-e-cola; `dados_extras` = txid/collection id), com lançamento no ledger (`forma_pagamento='PIX'`). Demais actions: `listar`, `detalhe`, `detalhe_publico` (página pública, faz verificação on-demand no BTG), `cancelar`, e internas `confirmar_pagamento`/`verificar`. Em **sandbox** o BTG é mockado (EMV fake) — o fluxo inteiro é testável sem banco real.

## 2) Confirmação: BTG → OB → Atrium

Três caminhos convergem no `pix-charges` (confirmação idempotente):

1. **Webhook BTG** (`btg-webhook`, família `instant-collections.*`): `_shared/btgEventos.ts` reconhece o evento, casa o `txid`/`collectionId` com o `payment_link` PIX_BTG e delega a `pix-charges confirmar_pagamento`.
2. **Polling** (`btg-poll-status`, cron 30 min): `pollPixCharges()` varre cobranças ATIVAS e chama `pix-charges verificar` (aplica expiração e consulta o BTG em produção).
3. **On-demand**: enquanto a página `/pix/:id` está aberta, o polling do frontend (5s) passa por `detalhe_publico`, que consulta o BTG — confirmação quase em tempo real.

Confirmado, o OB atualiza o link (PAGO), baixa o ledger e notifica o Atrium com retry `[0s, 2s, 5s]` + auditoria `cf_notify` (mesmo padrão do cartão):

`POST https://kvggebtnqmxydtwaumqz.supabase.co/functions/v1/payment-webhook` (header `x-service-key`)

```json
{
  "payment_link_id": "<id>",
  "metodo": "pix",
  "status": "PAGO",
  "txid": "...",
  "end_to_end_id": "E6074694...",
  "valor": 150.00,
  "nome_cliente": "Maria Silva",
  "descricao": "Lente Transition CR39",
  "pagador_nome": "MARIA DA SILVA",
  "pagador_documento": "***456789**",
  "dateTime": "2026-07-29T14:30:05-03:00",
  "origem_ref": "<uuid>",
  "origem": "ATRIUM_INFOCO"
}
```

`EXPIRADO` e `CANCELADO` são notificados da mesma forma. O Atrium move o card para "Pix Pago"/"Cancelado", conclui a solicitação e entrega o picote à loja.

## 3) Template WhatsApp (Meta)

Alias já cadastrado no Atrium: `pix_pagamento_cliente` → `pix_pagamento_cliente_v1` (UTILITY, pt_BR, 3 params: protocolo, valor, link). Sugestão de corpo:

> Olá! Aqui é da Óticas Diniz. Segue sua cobrança Pix — protocolo {{1}}.
> 💰 Valor: R$ {{2}}
> 💠 Pague pelo link (QR Code ou copia-e-cola): {{3}}
> ⏰ Válido por 24h.

Sem template aprovado o envio falha graciosamente e a loja compartilha o QR manualmente — o resto do fluxo funciona normal.

## 4) Pontos de atenção (produção BTG)

- **Endpoint BTG**: implementado como `POST /{cnpj}/banking/instant-collections` com parsing defensivo do retorno (`instantCollectionId|collectionId|id`, `emv|qrCode|pixCopiaECola|brcode`, `txid|txId|transactionId`). **Confirmar o contrato exato no portal do BTG** na primeira chamada real — logs completos são gravados em caso de formato inesperado.
- **Escopos OAuth**: adicionados `brn:btg:empresas:banking:collections`, `...instant-collections` e `...instant-collections.readonly` em `btg-auth` (grafia a confirmar no portal). **Empresas já autenticadas precisam reautorizar** para o token conter os novos escopos.
- **Chave Pix**: coluna opcional `btg_contas_bancarias.chave_pix` (migration `20260730170000_pix_charges_btg.sql`) — enviada ao BTG quando preenchida.
- **Webhook BTG**: garantir que a família `instant-collections.*` esteja habilitada no painel BTG apontando para o `btg-webhook` já existente.

## 5) Checklist de ativação

1. OB: aplicar migration + deploy (`pix-charges`, `btg-webhook`, `btg-poll-status`, `btg-auth`, frontend com `/pix/:id`) — automático via Lovable.
2. Atrium: aplicar migration `20260730170000_pix_automatico_btg.sql` + deploy (`criar-solicitacao-loja`, `payment-webhook`) e Messenger (desktop-joy-app).
3. BTG: reautorizar empresas (novos escopos), habilitar eventos `instant-collections.*` no painel, cadastrar `chave_pix` por conta (opcional).
4. Meta: criar e aprovar `pix_pagamento_cliente_v1`.
5. Testar em sandbox (mock) ponta a ponta; depois cobrança real de R$ 0,01 em loja piloto antes de liberar geral.

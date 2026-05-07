## Diagnóstico

Os 502 em `criar-solicitacao-loja` são causados por um **ReferenceError**: a variável `primeiroNome` é usada na linha 310 mas **nunca foi declarada** na função.

```ts
// Linha 310 (dentro do bloco de envio do template ao cliente)
descricao:
  envioClienteStatus === "enviado"
    ? `Link de pagamento enviado para ${primeiroNome} (${nomeLoja})`  // 💥 não definida
    : `Falha ao enviar link de pagamento: ${envioClienteErro}`,
```

A única variável de nome do cliente que existe no escopo é `nomeClienteRaw` (vinda de `dados.cliente`). Quando o template é enviado com sucesso, o código tenta acessar `primeiroNome`, dispara `ReferenceError`, e o catch externo devolve 502 — exatamente o status que aparece nos logs do navegador. Por isso também não há logs úteis em `edge_function_logs` (a stack do erro é jogada no catch genérico do `serve`).

O aviso de `apple-mobile-web-app-capable` é só um warning de PWA do Chrome, não tem relação com o 502 — `index.html` já tem `<meta name="mobile-web-app-capable" content="yes">`.

## Correção

**Arquivo:** `supabase/functions/criar-solicitacao-loja/index.ts`

1. Declarar `primeiroNome` logo após `nomeClienteRaw` (~linha 221):
   ```ts
   const primeiroNome = nomeClienteRaw.split(/\s+/)[0] || nomeClienteRaw;
   ```
2. Manter o uso atual em `eventos_crm.descricao`.

Sem outras mudanças — o restante do fluxo (OB payment-links, template, anexos, protocolo) já está correto.

## Validação

Após o deploy automático:
- Gerar um novo link de pagamento pela loja → deve voltar 200 com `url` e `payment_link_id`.
- Conferir `eventos_crm` com tipo `link_pagamento_enviado_cliente` referenciando o primeiro nome do cliente.

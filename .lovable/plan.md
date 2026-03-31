

# Plano: Comprovante de Pagamento ("Picote")

## Contexto

Quando o OB confirma um pagamento, o `payment-webhook` já recebe `tid`, `authorization`, `valor`. Precisamos:
1. Receber campos adicionais do OB (NSU, last4, parcelas, descrição, nome do cliente)
2. Armazenar tudo no metadata da solicitação
3. Enviar comprovante WhatsApp à loja solicitante
4. Exibir o "picote" visualmente no card/dialog do Pipeline Financeiro

---

## Alterações

### 1. Edge Function `payment-webhook/index.ts`

**Aceitar novos campos no payload:**
- `nsu`, `last4`, `installments`, `descricao`, `nome_cliente`

**Armazenar no metadata da solicitação:**
```
nsu, last4, installments, descricao, nome_cliente
```

**Após atualizar a solicitação (quando status === "PAGO"), enviar WhatsApp à loja:**
- Buscar `contato_id` da solicitação → buscar contato → telefone (a loja que solicitou)
- Buscar o `atendimento_id` do atendimento da loja (canal `whatsapp`, contato_id da loja)
- Montar a mensagem com o template do picote:

```text
📩 *Segue comprovante de pagamento da cliente {nome_cliente}*

✅ *Pagamento Confirmado!*

💰 Valor: R$ {valor}
📋 {descricao}

━━━━━━━━━━━━━━━━━━
🔑 *NSU: {nsu}*
   ↳ Use este número para baixa no sistema
━━━━━━━━━━━━━━━━━━

🆔 TID: {tid}
🔐 Autorização: {authorization}
📅 Data: {date} às {time}
💳 Cartão: **** {last4}
📦 Parcelas: {installments}x
```

- Enviar via `send-whatsapp` (invoke interno) ou diretamente via Evolution API (usando o provedor do atendimento da loja)

### 2. Frontend — `PipelineFinanceiro.tsx`

**No card (visão resumida):** Quando `metadata.payment_status === "PAGO"` e `metadata.nsu` existe, exibir badge verde com `NSU: {nsu}` abaixo do valor.

**No dialog de detalhes (non-CPF):** Renderizar um bloco visual "Comprovante de Pagamento" estilizado como picote, com bordas tracejadas e fundo verde claro, exibindo todos os campos: NSU (destaque), TID, autorização, data, cartão, parcelas.

### 3. Contrato esperado do OB

O OB precisa enviar estes campos adicionais no POST para `/payment-webhook`:

```json
{
  "payment_link_id": "...",
  "status": "PAGO",
  "tid": "...",
  "authorization": "...",
  "valor": 150.00,
  "nsu": "123456",
  "last4": "1234",
  "installments": 3,
  "descricao": "Óculos Ray-Ban",
  "nome_cliente": "Maria Silva"
}
```

---

## Resumo de arquivos

| Arquivo | Ação |
|---------|------|
| `supabase/functions/payment-webhook/index.ts` | Aceitar novos campos, armazenar, enviar WhatsApp à loja |
| `src/pages/PipelineFinanceiro.tsx` | Exibir picote no card e no dialog |

Nenhuma migração de banco necessária — os dados são armazenados no campo `metadata` (jsonb) existente.


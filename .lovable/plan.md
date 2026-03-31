

# Implementação: Comprovante de Pagamento ("Picote")

## Arquivo 1: `supabase/functions/payment-webhook/index.ts`

### Mudanças no payload (linha 31)
Extrair novos campos: `nsu`, `last4`, `installments`, `descricao`, `nome_cliente`

### Mudanças no metadata (linhas 91-97)
Adicionar ao `updatedMeta`: `nsu`, `last4`, `installments`, `descricao`, `nome_cliente`

### Mudança no evento CRM (linhas 116-117)
Incluir NSU na descrição e nos metadata do evento

### Novo bloco: Envio do picote via WhatsApp (após linha 124)
Quando `status === "PAGO"`:
1. Buscar contato (loja) pelo `contato_id` da solicitação
2. Buscar atendimento ativo WhatsApp para esse contato
3. Montar mensagem formatada com cabeçalho "Segue comprovante de pagamento da cliente {nome_cliente}" e o picote completo (NSU destacado entre separadores, TID, autorização, data/hora, cartão, parcelas)
4. Enviar via `supabase.functions.invoke("send-whatsapp")`
5. Falha no envio WhatsApp NÃO impede o retorno do webhook (try/catch isolado)

---

## Arquivo 2: `src/pages/PipelineFinanceiro.tsx`

### No card (após linha 427, antes do timestamp)
Quando `metadata.payment_status === "PAGO"` e `metadata.nsu` existe, exibir badge verde:
```tsx
<Badge className="bg-green-100 text-green-800 text-[10px]">
  🔑 NSU: {sol.metadata.nsu}
</Badge>
```

### No dialog de detalhes (após linha 533, dentro do bloco non-CPF)
Quando `metadata.payment_status === "PAGO"`, renderizar bloco "Comprovante de Pagamento" com:
- Borda tracejada, fundo verde claro (`bg-green-50 border-dashed border-green-300`)
- NSU em destaque (bold, maior) com separadores visuais
- TID, Autorização, Data, Cartão, Parcelas em linhas menores
- Nome do cliente no cabeçalho

---

## Contrato esperado do OB

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

Nenhuma migração de banco necessária — tudo armazenado no campo `metadata` (jsonb) existente.


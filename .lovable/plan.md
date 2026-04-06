

# Unificar CRM e Eliminar Duplicidade

## Contexto

Atualmente existem duas telas de pipeline separadas: **CRM** (`/crm`) mostra contatos de vendas (setor_id IS NULL) e **Lojas** (`/atendimento-gael`) mostra contatos do setor "Atendimento Gael". Ambas são operadas pelo mesmo back-office, gerando confusão. A tela Lojas também não abre conversas ao clicar nos cards.

## O que muda

### 1. Remover a página "Lojas" separada

- Deletar `src/pages/PipelineAtendimentoGael.tsx`
- Remover a rota `/atendimento-gael` do `App.tsx`
- Remover o módulo `atendimento_gael` da navegação (`TopNavigation.tsx`, `AppSidebar.tsx`, `AppLayout.tsx`)

### 2. Unificar todos os contatos no CRM (`/crm`)

O Pipeline CRM (`Pipeline.tsx`) hoje filtra apenas colunas com `setor_id IS NULL`. A mudança:

- `usePipelineColunas()` sem argumento continuará trazendo vendas
- Adicionar query separada para carregar colunas do setor "Atendimento Gael"
- Combinar ambas as listas de colunas no Kanban, com separação visual (ex: um divisor ou cor diferente na borda superior para colunas internas)
- Todos os cards terão o `onClick` que abre o `ConversationPanel` (já funciona no CRM atual)

### 3. Resumo automático no escalonamento humano

Quando `precisa_humano = true` no ai-triage, após escalar:

- Invocar `summarize-atendimento` automaticamente (já existe a edge function)
- O resumo será salvo em `atendimentos.metadata.resumo_ia`
- No `ConversationPanel`, exibir o resumo como um bloco destacado no topo da conversa (antes das mensagens), quando existir `resumo_ia` no metadata
- Formato: card com ícone de documento, fundo amarelo claro, com os pontos principais em poucas linhas

### 4. Ajustar ai-triage para resumo automático

No `ai-triage/index.ts`, após a linha que faz `update({ modo: "hibrido" })` quando `precisa_humano`:

```typescript
// Auto-generate summary for human agent
await fetch(`${SUPABASE_URL}/functions/v1/summarize-atendimento`, {
  method: "POST",
  headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ atendimento_id }),
});
```

## Arquivos modificados

| Arquivo | Ação |
|---------|------|
| `src/pages/PipelineAtendimentoGael.tsx` | Deletar |
| `src/App.tsx` | Remover rota `/atendimento-gael` |
| `src/components/layout/TopNavigation.tsx` | Remover aba "Lojas" |
| `src/components/layout/AppSidebar.tsx` | Remover item "Lojas" |
| `src/components/layout/AppLayout.tsx` | Remover módulo `atendimento_gael` |
| `src/pages/Pipeline.tsx` | Carregar e exibir colunas de todos os setores; exibir resumo IA no ConversationPanel |
| `supabase/functions/ai-triage/index.ts` | Chamar summarize-atendimento ao escalar para humano |

## Resultado

- Uma única tela CRM com todas as colunas (vendas + atendimento interno)
- Cards de loja e cliente, todos clicáveis com histórico de conversa
- Quando o humano abre um card escalado, vê imediatamente o resumo com motivo e pontos-chave, sem precisar ler toda a conversa
- Sem duplicidade de telas, sem confusão de navegação


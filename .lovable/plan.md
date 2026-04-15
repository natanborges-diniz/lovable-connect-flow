

# Fix: bot-lojas `dados is not defined` Error

## Problema

O número 8878 (Departamento Direção) envia mensagens, o webhook recebe corretamente e roteia para o `bot-lojas`, mas o bot crashia com:

```
ReferenceError: dados is not defined (line 428)
```

**Causa raiz**: Na linha 416, o código referencia `dados` antes de ser declarado. A variável `dados` só é desestruturada na linha 419 como `dados: dadosSessao`. Ou seja, na linha 416 o nome `dados` simplesmente não existe no escopo.

```typescript
// Linha 416 — BUG: "dados" não existe ainda
const currentParentId = (dados as any)?._menu_parent_id || null;

// Linha 419 — é aqui que "dados" é extraído com nome "dadosSessao"
const { fluxo, etapa, dados: dadosSessao } = sessao;
```

## Correção

Mover a desestruturação de `sessao` para **antes** da linha 416, e usar o nome correto `dadosSessao` (ou renomear para `dados`):

```typescript
// Desestruturar ANTES de usar
const { fluxo, etapa, dados: dadosSessao } = sessao;
const currentParentId = (dadosSessao as any)?._menu_parent_id || null;
```

## Arquivo Modificado

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/bot-lojas/index.ts` | Reordenar linhas 416-419: mover desestruturação antes do uso de `dados` e corrigir referência para `dadosSessao` |

Após a correção, redeploy da edge function.


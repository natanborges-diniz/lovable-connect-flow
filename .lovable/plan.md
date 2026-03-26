

## Plano: Adicionar "Criar Exemplo" no Feedback de Mensagem

### O que muda

No dialog de feedback negativo (👎) do `MessageFeedback.tsx`, adicionar um segundo toggle — **"Criar exemplo modelo"** — ao lado do já existente "Criar regra proibida". Quando ativado e o operador preencher a resposta corrigida, o sistema cria automaticamente um registro em `ia_exemplos` com:

- `categoria`: "correcao"
- `pergunta`: o motivo informado (contexto do erro)
- `resposta_ideal`: a resposta corrigida

### Mudanças

**1. `src/components/atendimentos/MessageFeedback.tsx`**

- Adicionar estado `criarExemplo` (boolean, default false)
- Adicionar toggle visual abaixo do toggle de regra proibida, com ícone `BookOpen` e texto "Criar exemplo modelo (ensinar a IA a responder assim)"
- O toggle só fica habilitado quando `respostaCorrigida` tem conteúdo
- No `submitNegative`, se `criarExemplo` estiver ativo, inserir em `ia_exemplos`
- Invalidar query `ia_exemplos` após criação
- Ajustar toast de sucesso para refletir as ações realizadas

### Resultado

O operador ao corrigir uma resposta da IA pode, no mesmo fluxo:
- Dar o feedback negativo
- Criar uma regra proibida (se for algo que nunca deve acontecer)
- Criar um exemplo modelo (se quiser ensinar como responder corretamente)
- Ou ambos simultaneamente


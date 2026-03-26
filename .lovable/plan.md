

## Plano: Sistema de Aprendizado Forte da IA

### Problema atual

O sistema já tem `ia_exemplos` (few-shot) e `ia_feedbacks` (👍/👎), mas é fraco:
- Apenas 10 exemplos e 3 anti-feedbacks são carregados no prompt
- Não existe conceito de **regra proibitiva** (ex: "NUNCA diga que fazemos exame de vista")
- Feedbacks negativos são enterrados na aba de configurações — difícil de acessar
- Não há prioridade: uma correção crítica (informação proibida) tem o mesmo peso que um ajuste de tom

### Solução: 3 camadas de aprendizado

```text
┌─────────────────────────────────────────┐
│ 1. REGRAS PROIBITIVAS (peso máximo)     │
│    "NUNCA diga X" → injetado como       │
│    bloco # PROIBIÇÕES ABSOLUTAS         │
│    Ex: "Não fazemos exame de vista"     │
├─────────────────────────────────────────┤
│ 2. CORREÇÕES (peso alto)                │
│    "Se perguntarem Y, responda Z"       │
│    → Exemplos modelo (ia_exemplos)      │
│    Limite aumentado de 10 → 30          │
├─────────────────────────────────────────┤
│ 3. FEEDBACKS (peso contextual)          │
│    👎 com motivo e correção             │
│    → Anti-exemplos (ia_feedbacks)       │
│    Limite aumentado de 3 → 10           │
└─────────────────────────────────────────┘
```

### Mudanças

**1. Nova tabela `ia_regras_proibidas`**

Regras absolutas que a IA nunca deve violar:
- `id`, `regra` (texto livre, ex: "Óticas não fazem exame de vista"), `categoria` (enum: informacao_falsa, comportamento, compliance), `ativo` (boolean), `created_at`
- Injetadas no prompt como bloco `# PROIBIÇÕES ABSOLUTAS` com peso máximo, antes dos exemplos

**2. Atualizar `ai-triage` (buildSystemPrompt)**

- Carregar `ia_regras_proibidas` ativas (sem limite)
- Injetar como bloco dedicado no prompt: `# PROIBIÇÕES ABSOLUTAS — VIOLAR = FALHA CRÍTICA`
- Aumentar limite de exemplos de 10 → 30
- Aumentar limite de anti-feedbacks de 3 → 10

**3. UI: Página dedicada de Aprendizado da IA**

Em vez do card pequeno atual em Configurações, criar uma seção com abas:

- **Aba "Regras Proibidas"**: Lista de regras com toggle ativo/inativo, botão criar nova regra (campo texto + categoria)
- **Aba "Exemplos Modelo"**: O que já existe no LearningCard, mas melhorado — com campo de busca e edição inline
- **Aba "Feedbacks"**: Dashboard com stats + lista de feedbacks negativos recentes com botão "Promover a Regra" (além do já existente "Promover a Exemplo")
- **Aba "Prompt"**: O prompt de atendimento atual (já existe em Configurações) movido para cá

**4. Fluxo rápido de correção (atalho)**

Na tela de Atendimentos, ao dar 👎 numa resposta da IA, adicionar opção "Criar regra proibida" além da correção atual. Ex: operador vê a IA dizendo "fazemos exame de vista" → 👎 → "Criar regra: Óticas não fazem exame de vista" → regra criada e ativa imediatamente.

### Implementação

1. **Migration**: criar tabela `ia_regras_proibidas` com RLS
2. **Edge Function `ai-triage`**: carregar regras proibidas, injetar no prompt, aumentar limites
3. **UI**: refatorar LearningCard em componente com abas (Regras, Exemplos, Feedbacks, Prompt)
4. **MessageFeedback**: adicionar opção "Criar regra proibida" no dialog de feedback negativo

### Resultado para o caso citado

Você criaria a regra: _"Óticas Diniz NÃO fazem exame de vista. É proibido por lei em óticas. Podemos indicar profissionais próximos e compensar com descontos."_

A IA receberia isso como:
```
# PROIBIÇÕES ABSOLUTAS — VIOLAR = FALHA CRÍTICA
- Óticas Diniz NÃO fazem exame de vista. É proibido por lei em óticas. 
  Podemos indicar profissionais próximos e compensar com descontos.
```

Isso garante que nunca mais a IA ofereça exame de vista, independente do contexto.


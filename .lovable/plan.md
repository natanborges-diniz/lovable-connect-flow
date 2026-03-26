

## Plano: Injetar Data/Hora Atual + Fortalecer Aprendizado

### Problemas identificados

1. **A IA não sabe que dia é hoje.** O prompt NÃO injeta a data/hora atual. Quando o cliente diz "sábado de manhã", a IA não consegue calcular a data (DD/MM) e fica pedindo ao cliente — absurdo.

2. **A regra proibida existe** ("Óticas não podem fazer exames") **e é carregada no prompt**, mas a IA ainda ofereceu "agendamos exame de vista com especialista". O problema é que a regra está fraca demais textualmente e a IA interpreta "clínica parceira" como diferente de "ótica fazendo exame".

3. **Nenhum exemplo modelo ativo** (`ia_exemplos` retornou vazio com `ativo = true`). Os feedbacks corrigidos existem mas não foram promovidos a exemplos.

### Solução

**1. Injetar data/hora atual no prompt (CRÍTICO)**

No `buildSystemPrompt`, adicionar logo no início:

```
# DATA E HORA ATUAL
Agora: quarta-feira, 26/03/2026 às 14:35 (horário de Brasília)
Próximo sábado: 29/03/2026
Próximo domingo: 30/03/2026

REGRA: Quando o cliente disser "sábado", "segunda", etc., CALCULE a data automaticamente. 
NUNCA peça ao cliente para informar a data em DD/MM — isso é trabalho SEU.
```

A data será calculada dinamicamente com `new Date()` usando timezone `America/Sao_Paulo`, incluindo o dia da semana e os próximos 7 dias nomeados.

**2. Fortalecer regras proibidas no prompt**

Atualmente as regras são injetadas como `- ❌ {regra}`. Vou adicionar reforço:

```
INSTRUÇÕES: Estas regras se aplicam A TODAS as situações, incluindo clínicas parceiras, 
indicações e qualquer variação. NÃO há exceções.
```

**3. Auto-promover feedbacks corrigidos a exemplos**

No `submitNegative` do `MessageFeedback.tsx`, quando o operador fornece `resposta_corrigida`, automaticamente criar o exemplo em `ia_exemplos` (sem precisar do toggle). O toggle "Criar exemplo" passará a vir **ligado por padrão** quando há resposta corrigida.

### Arquivos alterados

1. **`supabase/functions/ai-triage/index.ts`**
   - Função `buildSystemPrompt`: adicionar seção `# DATA E HORA ATUAL` com cálculo dinâmico dos próximos 7 dias
   - Reforçar bloco de proibições com instrução de aplicação universal
   - Adicionar regra explícita: "NUNCA peça data DD/MM ao cliente"

2. **`src/components/atendimentos/MessageFeedback.tsx`**
   - Toggle "Criar exemplo" vem ligado por padrão quando `respostaCorrigida` tem conteúdo

### Resultado

- A IA saberá que "sábado" = 29/03/2026 e usará a tool `agendar_visita` com ISO date diretamente
- As regras proibidas terão peso reforçado no prompt
- Feedbacks com correção criarão exemplos automaticamente, acelerando o aprendizado


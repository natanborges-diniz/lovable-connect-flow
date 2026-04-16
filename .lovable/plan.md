

# Plano: Corrigir Saudação da IA + Layout do Dialog de Atendimento

## Problema 1 — IA não cumprimenta o cliente

Na primeira mensagem, o Gael pula direto para perguntas sobre receita sem sequer cumprimentar. O bloco de identidade no prompt (linha 686) diz apenas "Atendimento rápido, preciso e humano" mas não instrui como abrir a conversa com novos contatos.

**Causa**: Quando `inboundCount === 1`, o `buildContinuityBlock` retorna vazio. Não existe nenhuma instrução de "primeira mensagem" que oriente o Gael a cumprimentar e perguntar o que o cliente precisa antes de partir para triagem.

## Problema 2 — Layout estourando no dialog

O dialog de detalhe do atendimento tem `max-w-2xl` fixo e a área de badges/status não tem `flex-wrap` adequado + o texto das mensagens usa `max-w-[80%]` que pode estourar em telas menores (~1000px). O conteúdo interno não está restrito a `overflow-hidden`.

---

## Correções

### 1. Adicionar bloco de "Primeira Interação" no prompt (`ai-triage/index.ts`)

Criar uma função `buildFirstContactBlock()` que é injetada quando `inboundCount === 1`:

```
# PRIMEIRA INTERAÇÃO
- Cumprimente o cliente de forma calorosa e natural (ex: "Oi! Tudo bem? 😊").
- Pergunte como pode ajudá-lo. NÃO assuma o que ele precisa.
- NÃO mencione receita, lentes ou agendamento na primeira mensagem.
- Deixe o CLIENTE dizer o que deseja antes de fazer qualquer triagem.
- Exemplo: "Oi! Aqui é o Gael das Óticas Diniz Osasco 😊 Como posso te ajudar hoje?"
```

Injetar essa função em `buildSystemPrompt` e `buildSystemPromptFromCompiled`, logo após `buildDateContext()`, condicionado a `inboundCount <= 1`.

### 2. Corrigir layout do dialog (`Atendimentos.tsx`)

- Na `DialogContent`: adicionar `overflow-hidden` para evitar estouros
- Na área de badges (linha ~230-267): garantir `flex-wrap gap-2` e limitar largura
- Nas mensagens (linha 275): reduzir `max-w-[80%]` para `max-w-[75%]` e adicionar `break-words`/`overflow-hidden`
- Adicionar `min-w-0` nos containers flex para evitar que filhos forcem overflow

### 3. Salvar regra de tom em memória

Atualizar `mem://ia/perfil-comportamental-gael-tom-e-voz-unificado` com a regra de saudação cadenciada.

---

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/ai-triage/index.ts` | Adicionar `buildFirstContactBlock()` + injetar em ambos builders |
| `src/pages/Atendimentos.tsx` | Fix overflow no dialog: `overflow-hidden`, `break-words`, `min-w-0` |
| `mem://ia/perfil-comportamental-gael-tom-e-voz-unificado` | Adicionar regra de saudação cadenciada |


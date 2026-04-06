

# Corrigir Comportamento de Retomada de Conversa

## Problemas Identificados

1. **Re-apresentação desnecessária**: O Gael diz "Aqui é o Gael das Óticas Diniz" mesmo quando o cliente já o conhece. Não existe nenhuma regra no system prompt que diga "se já conversou antes, NÃO se apresente novamente".
2. **Mensagem duplicada**: Enviou 2 respostas em vez de 1 — o debounce de 3s pode ter falhado para mensagens rápidas.
3. **Sugestão de região fora da cobertura**: Empurrou o cliente para Guarulhos sem checar se é uma região atendida. Sem guardrail no prompt.
4. **Compilação não refletida**: Feedback anterior sobre esses temas não foi incorporado na resposta.

## Mudanças

### 1. Adicionar regra de "Continuidade" no ai-triage

No `buildSystemPrompt` e `buildSystemPromptFromCompiled`, injetar um bloco de CONTINUIDADE antes da classificação:

```
# CONTINUIDADE DE CONVERSA
- Se o histórico mostra que você JÁ conversou com este cliente: NÃO se apresente novamente. NÃO diga "Aqui é o Gael". Retome naturalmente, de forma simpática e direta.
- Use tom de quem já conhece o cliente: "Oi [nome], que bom te ver de volta!" ou "E aí, tudo bem? Vamos retomar de onde paramos?"
- Se o cliente retorna após inatividade: reconheça de forma calorosa e retome o contexto da conversa anterior, sem repetir informações já dadas.
```

A lógica para decidir se é retorno: verificar se `inboundCount > 1` (já houve troca de mensagens anterior).

### 2. Adicionar regra de cobertura regional

Injetar no system prompt:

```
# COBERTURA REGIONAL
- Você atende APENAS nas regiões de Osasco e região.
- NUNCA sugira lojas ou atendimento em cidades fora da nossa cobertura (como Guarulhos, São Paulo capital, etc.) a menos que tenhamos loja lá.
- Se o cliente for de uma região sem loja: informe que no momento atendemos em Osasco e região, e convide para conhecer.
```

### 3. Aumentar janela de debounce

No ai-triage, a constante `DEBOUNCE_WAIT_MS` está em 3000ms (3s). Para evitar respostas duplicadas quando o webhook dispara em sequência rápida (ex: mensagem automática + mensagem do cliente):

- Aumentar `DEBOUNCE_WAIT_MS` de 3000 para 5000ms
- Adicionar checagem se a última mensagem outbound foi enviada há menos de 10s — se sim, skip

### 4. Adicionar exemplos de retomada como feedback/exemplo

Inserir via migration 2 exemplos na tabela `ia_exemplos`:
- Categoria: "retomada"
- Pergunta: "boa tarde" (cliente retornando após inatividade)
- Resposta ideal: "Oi! Que bom que voltou 😊 Vamos retomar? Da última vez conversamos sobre [contexto]. Quer continuar por aí?"

### 5. Adicionar regra proibida

Inserir regra proibida: "NUNCA se reapresente ('Aqui é o Gael') em conversas que já tiveram troca de mensagens anterior."

## Arquivos

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/ai-triage/index.ts` | Regras de continuidade, cobertura regional, debounce aumentado |
| Migration SQL | Exemplos de retomada + regra proibida |

## Resultado

- Cliente que retorna recebe acolhimento natural, sem re-apresentação
- IA nunca sugere regiões fora da cobertura
- Respostas duplicadas eliminadas pelo debounce mais robusto
- Prompt compilado incorporará as novas regras na próxima recompilação


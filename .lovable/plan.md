

# Corrigir Comportamento Pós-Escalonamento + Build Errors

## Problemas

1. **IA continua fazendo perguntas picadas após escalar**: Após chamar `escalar_consultor`, a IA deveria parar de coletar dados sobre o assunto escalado, mas continua perguntando marca, tipo, receita — uma por vez.
2. **Gate pós-escalonamento precisa ser inteligente**: A IA deve parar de puxar conversa sobre o assunto escalado, mas permanecer disponível se o CLIENTE iniciar uma pergunta nova (outro assunto, dúvida sobre horário, endereço, etc.).
3. **Build errors**: `useAtendimentos.ts` e `useTarefas.ts` usam `Record<string, unknown>` incompatível com tipos Supabase.

## Correções

### 1. Migration SQL — Regras de comportamento pós-escalonamento

**Atualizar regra de lentes de contato** para incluir mini-questionário consolidado na mensagem de escalonamento (uma única mensagem com todas as perguntas relevantes).

**Inserir regra global**: "Após usar a tool escalar_consultor, NÃO faça mais perguntas sobre o assunto escalado. Se o cliente enviar uma nova pergunta sobre OUTRO assunto, responda normalmente. Se perguntar sobre o assunto escalado, diga apenas que o Consultor está a caminho."

**Inserir regra global sobre perguntas picadas**: "NUNCA faça perguntas de forma picada (uma por vez em mensagens separadas). Se precisar coletar informações, consolide todas as perguntas relevantes em uma única mensagem com objetivo claro."

### 2. `supabase/functions/ai-triage/index.ts` — Contexto pós-escalonamento

No system prompt, quando o atendimento estiver em modo `hibrido`, injetar instrução contextual:

- "Este atendimento foi escalado para Consultor especializado. O assunto escalado é: [motivo]. NÃO faça perguntas sobre este assunto. Se o cliente perguntar sobre ele, informe que o Consultor está a caminho. Se o cliente iniciar um assunto DIFERENTE, responda normalmente."

Isso dá ao LLM a informação necessária para distinguir entre "cliente perguntando sobre o assunto escalado" vs "cliente com dúvida nova".

Na mensagem de escalonamento por lentes de contato, consolidar o mini-questionário:

> "Lentes de contato é com nosso Consultor especializado! Para adiantar seu atendimento, me conta: você já usa lentes de contato? Se sim, qual marca/tipo e tem receita atualizada? Vou passar tudo pro Consultor te atender já preparado 🤝"

### 3. `src/hooks/useAtendimentos.ts` — Fix build error

Trocar `Record<string, unknown>` por tipo explícito:
```typescript
const updates: { status: StatusAtendimento; inicio_at?: string; fim_at?: string } = { status };
```

### 4. `src/hooks/useTarefas.ts` — Fix build error

Mesmo padrão:
```typescript
const updates: { status: StatusTarefa; concluida_at?: string } = { status };
```

## Arquivos afetados

| Arquivo | Mudança |
|---------|---------|
| Migration SQL | Regra pós-escalonamento inteligente, regra anti-perguntas picadas, atualizar regra lentes de contato |
| `supabase/functions/ai-triage/index.ts` | Injetar contexto de assunto escalado no prompt quando modo híbrido; mini-questionário consolidado |
| `src/hooks/useAtendimentos.ts` | Fix tipo do `updates` |
| `src/hooks/useTarefas.ts` | Fix tipo do `updates` |

## Resultado

- Após escalar, IA para de perguntar sobre o assunto escalado
- Se o cliente iniciar conversa sobre outro assunto, IA responde normalmente (modo híbrido funciona)
- Quando humano envia primeira mensagem, IA desativa (comportamento existente preservado)
- Coleta de info consolidada em uma única mensagem
- Build errors corrigidos


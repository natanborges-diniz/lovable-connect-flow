

## Plano: Forçar IA a respeitar o prompt (anti-repetição e regras de conduta)

### Diagnóstico

O prompt está sendo carregado do banco e enviado à IA. Porém:
1. **Tool calling reduz aderência ao system prompt** -- o modelo foca em preencher os campos da ferramenta e "esquece" regras do system prompt
2. **Bloco de texto muito longo** -- regras de negócio, anti-repetição e classificação estão misturadas num único system message
3. **O campo `resposta` da tool não reforça as regras** -- a descrição diz apenas "Texto de resposta para enviar ao cliente"

### Solução (3 mudanças na Edge Function `ai-triage`)

**1. Reforçar regras na descrição do campo `resposta` da tool**

Atualizar a `description` do campo `resposta` no schema da ferramenta para incluir regras críticas diretamente:

```
"Texto de resposta para enviar ao cliente via WhatsApp. 
REGRAS OBRIGATÓRIAS:
- NUNCA repita endereço, horário, telefone ou dados já enviados no histórico.
- Se a informação já foi dita, responda 'Conforme mencionei...' de forma breve.
- Respostas CURTAS e DIRETAS.
- Siga rigorosamente as regras de atendimento do system prompt."
```

**2. Injetar resumo do que já foi dito como contexto explícito**

Antes de chamar a IA, analisar o histórico de mensagens outbound e criar uma lista de "informações já enviadas" (endereços, horários, telefones mencionados). Adicionar isso como um bloco no system prompt:

```
INFORMAÇÕES JÁ ENVIADAS NESTA CONVERSA (NÃO REPITA):
- [lista extraída do histórico de mensagens outbound]
```

**3. Separar system prompt em mensagens distintas**

Em vez de um único system message gigante, usar múltiplas mensagens de sistema/contexto para dar mais peso às regras:
- Mensagem 1 (system): Regras de atendimento do prompt configurável
- Mensagem 2 (system): Regra anti-repetição + lista do que já foi dito
- Histórico da conversa
- Mensagem final (system): Instruções de classificação (internas)

### Componente alterado

| Componente | Ação |
|---|---|
| `supabase/functions/ai-triage/index.ts` | Reestruturar mensagens, reforçar descrição da tool, extrair contexto do histórico |

### Resultado esperado

A IA vai parar de repetir informações porque:
- As regras anti-repetição estão na **descrição da ferramenta** (onde o modelo presta mais atenção)
- O histórico do que já foi dito é **explicitamente listado** (o modelo não precisa inferir)
- As instruções estão **separadas por prioridade** em vez de misturadas


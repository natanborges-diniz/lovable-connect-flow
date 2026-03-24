

## Plano: Corrigir Assistente IA — Repetição e Falha de Escalonamento

### Diagnóstico (análise do histórico real)

Analisei o diálogo do número de homologação `5511963268878`. Os problemas encontrados:

| Problema | O que aconteceu |
|---|---|
| **Repetição idêntica** | A IA enviou a MESMA resposta (endereço Itapevi + horário) duas vezes seguidas |
| **Ignorou pedido de consultor** | Cliente disse "quero falar com consultor" → IA respondeu com endereço de loja em vez de acionar `solicitar_humano` |
| **Classificação errada** | "quero saber sobre lentes" foi classificada como `informacoes` e respondida com endereço |
| **Knowledge base vazia** | `knowledge: 0` nos logs — sem dados de produtos/lentes, a IA só tem os endereços do prompt e usa como resposta padrão |

### Causas raiz

1. **Sem knowledge base**: A tabela `conhecimento_ia` está vazia. Sem dados de produtos, a IA só consegue citar endereços e horários que estão no prompt
2. **Tool selection fraca**: A descrição das tools não deixa claro QUANDO usar `solicitar_humano` — a IA escolhe `classify_and_respond` para tudo
3. **Anti-repetição ineficaz**: O `alreadySentSummary` injeta TODO o texto das respostas anteriores, mas o modelo ignora essa massa de texto
4. **Prompt com dados demais**: Endereços de 10+ lojas no prompt fazem a IA gravitar para essa informação como "resposta segura"

### Solução (4 frentes)

#### 1. Detecção de keywords antes da IA

Adicionar pré-processamento no `ai-triage`: se a mensagem contém keywords explícitas de escalonamento ("falar com consultor", "atendente humano", "pessoa real", etc.), forçar a tool `solicitar_humano` sem depender do GPT.

```text
Keywords de escalonamento → bypass OpenAI → solicitar_humano direto
```

#### 2. Melhorar descrições das tools

Atualizar as descrições para serem mais prescritivas:

- `classify_and_respond`: Adicionar "NÃO use esta tool se o cliente pedir explicitamente para falar com um consultor ou pessoa real"
- `solicitar_humano`: Adicionar "Use OBRIGATORIAMENTE quando o cliente pedir para falar com pessoa real, consultor, atendente"
- Todas as tools: Reforçar "NUNCA repita informações já enviadas"

#### 3. Anti-repetição robusta

Em vez de injetar todo o texto das respostas anteriores (que o modelo ignora), criar um **resumo estruturado** das informações já compartilhadas:

```text
INFORMAÇÕES JÁ COMPARTILHADAS (PROIBIDO REPETIR):
- ✅ Endereço loja Itapevi: já informado
- ✅ Horário Itapevi: já informado
- ✅ Sugestão agendamento: já feita
```

Extrair tópicos-chave das mensagens outbound em vez de colar o texto inteiro.

#### 4. Fallback inteligente para knowledge base vazia

Se o cliente pergunta sobre um tema (ex: "lentes") e não há dados na `conhecimento_ia`, a IA deve:
- Reconhecer que não tem dados detalhados
- Oferecer os valores base do prompt (R$198 visão simples, R$298 multifocal)
- Sugerir enviar foto da receita para orçamento personalizado
- NÃO pular para endereço de loja como resposta padrão

Adicionar instrução explícita: "Se o cliente perguntar sobre produtos e você não encontrar detalhes na BASE DE CONHECIMENTO, use os valores base das REGRAS DE ATENDIMENTO. NUNCA responda com endereço de loja quando o cliente pergunta sobre produtos."

### Componentes alterados

| Componente | Ação |
|---|---|
| `ai-triage/index.ts` | Pre-check keywords escalonamento, melhorar tool descriptions, refatorar anti-repetição, adicionar fallback para KB vazia |

### Resultado esperado

```text
"quero saber sobre lentes"
  → IA responde sobre lentes (valores base) + sugere enviar receita
  (NÃO endereço de loja)

"quero falar com consultor"
  → keyword detectada → solicitar_humano → modo híbrido
  → "Já acionei um Consultor especializado..."
  (NÃO endereço de loja)
```


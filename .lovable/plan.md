

## Diagnóstico (caso Fábia Miranda + similares)

3 falhas combinadas que causam loop infinito quando cliente envia receita:

1. **`interpretar_receita` nunca dispara automaticamente** — IA reconhece a imagem ("Recebi sua imagem"), mas não chama o OCR. Resultado: `metadata.receitas` vazio, sem dados pra montar orçamento.
2. **Anti-repetição falha** — mesma frase enviada 3x idênticas (validador de similaridade não bloqueou).
3. **Resposta do cliente é ignorada** — Fábia respondeu "Lentes compatíveis" e "Orçamento inicial" duas vezes; IA voltou ao mesmo prompt em vez de executar a ação.

## Solução

### 1. Auto-disparo de `interpretar_receita` (prioridade absoluta)
No `ai-triage`, **antes** de chamar o LLM:
- Se a última inbound é `tipo_conteudo: image` E (intenção pendente é `quote/orcamento` OU não há receita em `metadata.receitas`)
- → executar `interpretar_receita` direto, sem perguntar "quer que eu analise?"
- Salvar resultado em `contatos.metadata.receitas[]`
- Injetar no prompt: `[RECEITA RECÉM-INTERPRETADA: esférico=X, cilíndrico=Y, adição=Z → tipo: progressiva/visão simples]`
- LLM já responde com orçamento real

### 2. Detector de loop (anti-repetição reforçado)
Função `detectLoop(outboundsRecentes)`:
- Pega últimas 3 outbound da IA
- Se 2+ têm similaridade >70% entre si → **loop detectado**
- Comportamento:
  - Se há intent claro do cliente nas últimas 2 inbound (ex: "orçamento inicial", "lentes compatíveis") → forçar execução da tool correspondente, ignorar prompt genérico
  - Se não há intent claro → escalar pra humano com motivo `loop_ia_detectado`
- Bypass do validator: roda **antes** do guardrail de similaridade, não pode ser pulado por fallback

### 3. Watchdog de inatividade pós-resposta
Novo cron job `watchdog-loop-ia` (a cada 2 min):
- Buscar atendimentos onde:
  - `modo = 'ia'`
  - última msg é `outbound` há >5min
  - cliente respondeu (inbound) **antes** dessa outbound
  - últimas 2 outbound têm similaridade >70%
- Ação: escalar pra humano + notificação "card em loop, requer atenção"
- Log em `eventos_crm` tipo `loop_ia_escalado`

### 4. Mapeamento intent → tool no `ai-triage`
Quando o cliente responde com palavras-chave claras a uma pergunta da IA:
- "orçamento inicial" / "orçamento" → forçar `quote_engine` (se receita existe) ou `interpretar_receita` (se há imagem pendente)
- "lentes compatíveis" / "opções" → forçar `quote_engine` ou pedir receita
- "agendar" / "marcar" → forçar `agendar_cliente`
- Não voltar ao mesmo prompt por inércia.

## Arquivos

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/ai-triage/index.ts` | Auto-disparo de `interpretar_receita` antes do LLM quando há imagem pendente; detector de loop pré-validator; mapeamento intent→tool forçado |
| `supabase/functions/watchdog-loop-ia/index.ts` (novo) | Cron job que escala cards em loop após 5min de inatividade |
| `supabase/migrations/<nova>` | Inserir cron_job `watchdog-loop-ia` (a cada 2 min) |
| `mem://ia/auto-receita-e-anti-loop` (novo) | Documentar regras: imagem+orçamento = OCR auto; loop detectado = forçar tool ou escalar |

## O que NÃO muda
- Fluxo da continuidade humano→IA (já implementado) permanece
- Quote engine, interpretar_receita, agendar_cliente — código das tools intacto
- Anti-repetição existente continua, mas agora com camada anterior (loop detector)

## Salvaguardas
- Auto-OCR só dispara 1x por imagem (marca `metadata.receitas_processadas[message_id]`)
- Loop detector só age se há ≥3 outbound recentes (evita falso positivo em conversa nova)
- Watchdog respeita modo: não escala se já está em humano/híbrido
- Logs detalhados em `eventos_crm` para auditoria de cada intervenção


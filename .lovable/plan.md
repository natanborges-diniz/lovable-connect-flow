## Contexto

Atendimento `4689bd82-ffb4-438b-bb79-9360e7294e67` (Thais Santiago, 5511967141957) está em `modo=ia / status=aguardando`. A última inbound é a receita digitada (`OD: Esférico Plano / -2,5 cil / 05 eixo / OE: Esférico Plano / -2,75 cil / 175 eixo`) e a última outbound é a escalada genérica fora-de-horário enviada antes do fix do parser.

Com o patch já mergeado em `detectPrescriptionCorrection`, basta re-disparar `ai-triage` para esse atendimento que ele:
1. Detecta o prompt anterior pedindo receita por texto → entra em modo `client_typed_first`.
2. Persiste `receitas[0]` em `contatos.metadata` com `od:{sphere:0,cyl:-2.5,axis:5}` e `oe:{sphere:0,cyl:-2.75,axis:175}`, `rx_type=single_vision`.
3. Hint pós-correção força `consultar_lentes` e responde com 3 faixas de orçamento.

## Ação

Invocar `supabase.functions.invoke('ai-triage', { atendimento_id, contato_id, force_resume: true, motivo: 'reprocessar_receita_digitada_pos_fix_parser' })` via `curl_edge_functions` (ou `supabase--curl_edge_functions`) com a service-role key.

Antes: confirmar via `read_query` que a receita ainda não está salva (`metadata->'receitas' is null`). Já confirmado.

Depois: `read_query` em `mensagens` ordenado por `created_at desc` para validar:
- Outbound nova com 3 faixas de orçamento OU pergunta de tipo de lente.
- `contatos.metadata->'receitas'` populado.

## Reversão / segurança

- Se a IA escalar de novo, voltar ao plano anterior e investigar logs (`supabase--edge_function_logs ai-triage`).
- Operação idempotente: ai-triage debounce (5s) e detector de receita evitam duplicar mensagem.

## Arquivos

Nenhum. Apenas chamada operacional à edge function existente.

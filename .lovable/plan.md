## Objetivo
Forçar redeploy do `ai-triage` (preso em v876) via edição interna trivial no Lovable, já que sync GitHub e Publish não disparam autodeploy de edge function.

## Passos

1. **Editar `supabase/functions/ai-triage/index.ts`** — adicionar 1 linha de comentário logo após o bloco de imports:
   ```ts
   // deploy trigger 2026-06-10 — ativar Fatia 2a/2b consulta OS + fix logEvent
   ```
   Salvar via `code--line_replace` (edição interna Lovable → dispara autodeploy de edge function).

2. **Verificar nova version** via `supabase--analytics_query` em `function_edge_logs` filtrando `function_id` do ai-triage. Comparar `deployment_id`/`version` contra o atual 876.

3. **Smoke test** com `supabase--curl_edge_functions` POST `/ai-triage` body `{"ping":true}` (vai dar 500 por `atendimento_id required`, mas gera log). Depois `supabase--edge_function_logs` para confirmar:
   - novo `deployment_id`/`version` no log,
   - ausência de `ReferenceError: logEvent is not defined`.

4. **Validação de integridade do código** via `rg`/`grep` no arquivo:
   - `iniciarColetaOS` (definição) presente,
   - case `"status_pedido"` chamando `iniciarColetaOS`,
   - 6 ocorrências de `eventos_crm.insert`,
   - `rg "logEvent" supabase/functions/ai-triage/index.ts` → 0 matches.

5. **Fallback** — se a version não mudar após 60–90s, parar e reportar (sem CLI/PAT), descrevendo o que foi observado para você avaliar próximo caminho.

## Resposta final
Vou te responder os 5 pontos exigidos com: linha exata adicionada, version antiga → nova, output do smoke test (deployment_id observado + ausência de ReferenceError), resultado dos greps de integridade.

## Observação
Estou em plan mode, então não posso editar o arquivo nem rodar tools de deploy até você aprovar este plano. Aprova que eu executo na sequência.

## Diagnóstico

Investiguei o atendimento `6dfa0ca0-ea1e-4cde-b336-da6c179608f9` (Letícia, agendamento `af24fbf6…`, DINIZ UNIÃO).

**Estado atual no banco:** `data_horario = 2026-07-04 17:00:00+00`, que em `America/Sao_Paulo` é exatamente **14:00** — ou seja, o registro persistido está **correto**. `updated_at` é `2026-07-03 12:31:28+00` (posterior ao lembrete e à mensagem "Presença confirmada").

**As três mensagens ao cliente, no entanto, divergem:**

| Momento | Autor | Texto | Análise |
|---|---|---|---|
| 02/07 16:58 | Operador (humano) | "sábado 04/07 às 14:00h" | ✅ correto |
| 03/07 08:00 SP (cron) | `agendamentos-cron` (lembrete véspera) | "amanhã às *17:00*" | ❌ mostrou UTC como se fosse SP |
| 03/07 09:29 SP (após clique ✅ Confirmo) | IA (LLM), não o handler determinístico | "Presença confirmada para amanhã às *20:00*" | ❌ LLM aplicou +3h em cima de um valor já em UTC (17+3=20) |

Duas causas independentes coexistem:

### Causa 1 — LLM formatando data/hora livremente

O handler determinístico `show_confirma` (ai-triage:11004-11026) usa `toLocaleTimeString(..., timeZone:"America/Sao_Paulo")` corretamente e responde "✅ Confirmado! Te esperamos…". Verifiquei em `mensagens`: **esse texto não foi enviado**; `confirmacao_enviada` seguiu `false` e `metadata.cliente_confirmou_at` **não existe**. Ou seja, o botão ✅ **não entrou no router determinístico** — o inbound "✅ Confirmo" caiu no fluxo LLM normal, que gerou livremente "Presença confirmada para amanhã às 20:00", tratando o `data_horario` ISO (`…T17:00:00+00`) como já sendo SP e somando 3h.

Isso viola a regra "IA não formata data/hora de agendamentos" — só o código determinístico deveria escrever hora.

### Causa 2 — Lembrete véspera com hora deslocada

O código de `agendamentos-cron` linha 410 usa `timeZone:"America/Sao_Paulo"` corretamente (testei em Deno/Node: para `2026-07-04T17:00:00+00` retorna `14:00`). Ainda assim o outbound registrado em `mensagens` (id `03dd4aaa…`) mostra `17:00`. Outros lembretes do mesmo cron/mesmo dia renderizaram SP corretamente (Neide 10:00, Gii 13:30, JB 11:00). Só esse registro divergiu — indício forte de que `data_horario` foi **mutado** depois do envio do lembrete e antes da minha consulta. `updated_at` é 3 min após a mensagem "Presença confirmada", coerente com uma reescrita silenciosa.

Preciso instrumentar para identificar quem reescreve `data_horario`.

## Plano de correção

### 1. Blindar handler `show_confirma` para o botão ✅ Confirmo sempre entrar
- No `ai-triage`, garantir que qualquer inbound que corresponda ao button reply (`show_confirma`, título `✅ Confirmo`, ou texto exato `✅ Confirmo`) **entre no router determinístico ANTES do LLM**, mesmo quando o webhook entrega como `text` (Meta ocasionalmente entrega o título como texto puro).
- Detector pré-LLM: se houver agendamento em `lembrete_enviado`/`agendado` para o contato E o inbound bater um dos gatilhos acima, chamar o handler `show_confirma` e **encerrar** sem LLM.
- Log claro: `[BUTTON ROUTER FALLBACK] matched by text — bypassing LLM`.

### 2. Proibir LLM de escrever data/hora de agendamento na resposta
- Reforçar prompt: quando `agendamentos_ativos[*].status` cobre a data mencionada pelo cliente, IA **não pode** reescrever "às HH:MM" — deve responder apenas confirmando/reagendando sem repetir hora, ou usar a mensagem fixa.
- Sanitizer pós-LLM em `ai-triage`: se `resposta` contém padrão "às NN:NN" ou "às NNh" **e** existe agendamento ativo cuja hora SP diverge do valor citado, substituir por template determinístico "✅ Confirmado! Te esperamos <data> às <hora SP> na <loja>." usando `toLocaleTimeString` com `timeZone:"America/Sao_Paulo"`. Auditoria via `ia_feedbacks` (avaliacao=`hora_alucinada`).

### 3. Instrumentar mutações silenciosas em `agendamentos.data_horario`
- Trigger `BEFORE UPDATE ON agendamentos` que, se `OLD.data_horario IS DISTINCT FROM NEW.data_horario`, insere em `eventos_crm` com tipo `agendamento_horario_alterado`, `metadata = { antes, depois, ator: current_setting('request.jwt.claims',true) }`.
- Depois de rodar 24-48h, revisitar para localizar o call-site que estava re-gravando `data_horario` errado no caso da Letícia.

### 4. Corrigir manualmente o caso da Letícia
- Enviar mensagem operacional pelo próprio canal: "Corrigindo: seu agendamento é **sábado 04/07 às 14h** na DINIZ UNIÃO. Confirmado!"
- Sem alterar `data_horario` (já está correto).

## Detalhes técnicos

**Arquivos afetados:**
- `supabase/functions/ai-triage/index.ts` — detector pré-LLM para "✅ Confirmo" (item 1) e sanitizer pós-LLM (item 2).
- `supabase/migrations/<novo>.sql` — trigger de auditoria em `agendamentos` (item 3).
- Prompt em `ia_instrucoes_prompt` — regra "não reescrever hora de agendamento" (item 2).

**Não altero:**
- `agendamentos-cron/index.ts` (código correto).
- `agendar-cliente/index.ts` (código correto).
- Schema de `agendamentos` além do trigger.

Após aprovado, implemento na ordem 1 → 2 → 3 → 4.
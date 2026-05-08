# Dois problemas, duas correções

## Problema 1 — cards "Confirmado" com data passada

### Diagnóstico
Inspecionei os 5 cards travados em **Confirmado** (datas 30/04 → 05/05, hoje 08/05). Todos têm:
- `confirmacao_enviada = true`
- `tentativas_cobranca_loja = 0`
- `loja_confirmou_presenca = null`

Isto é um **estado impossível** pelas regras do cron `agendamentos-cron`:

1. `processFirstStoreCharge` filtra por `confirmacao_enviada=false AND tentativas_cobranca_loja=0`. Como o flag já está `true`, **nunca dispara a 1ª cobrança**.
2. `processSecondStoreChargeNextMorning` exige `tentativas_cobranca_loja=1`. Como ficou em 0, **nunca dispara a 2ª**.
3. `processStoreTimeout` (que viraria `no_show` / cria tarefa) exige `tentativas_cobranca_loja >= 2`. **Nunca dispara**.

Resultado: o card nasce já com `confirmacao_enviada=true` (provavelmente setado por automação quando o **cliente** confirmou — campo com semântica ambígua entre "cliente confirmou" e "loja foi cobrada") e o cron passa direto. Fica órfão indefinidamente em "Confirmado" mesmo dias após a data.

### Correção
1. **Backfill imediato dos 5 órfãos**: para cada card em `confirmado`/`agendado`/`lembrete_enviado` com `data_horario < now() - 2h` e `loja_confirmou_presenca IS NULL`, resetar `confirmacao_enviada=false, tentativas_cobranca_loja=0` para o cron retomar a cadência. Caso já tenha passado da janela de 48h, mover direto para `no_show`.
2. **Guardrail no cron** (`agendamentos-cron/index.ts`):
   - Em `processFirstStoreCharge`, trocar o filtro de `confirmacao_enviada=false` por **OR**: aceitar tanto `confirmacao_enviada=false` quanto `tentativas_cobranca_loja=0` (o que pega o estado inconsistente).
   - Adicionar bloco final **G2** ("recuperação_orfao_confirmado"): qualquer card em `agendado`/`lembrete_enviado`/`confirmado` com `data_horario < now() - 24h` e `loja_confirmou_presenca IS NULL` é movido para `no_show` automaticamente, com evento `agendamento_orfao_resgatado` no `eventos_crm`.
3. **Separar semântica** do campo: introduzir uso explícito de `metadata.cliente_confirmou_at` (já existe) e parar de usar `confirmacao_enviada` para representar "cliente confirmou". `confirmacao_enviada` passa a significar **apenas** "1ª cobrança à loja enviada".

## Problema 2 — Card sair do CRM e virar card no Pipeline Lojas com histórico de conversas

### Estado atual
`TransferPipelineDialog` (acionado em `Pipeline.tsx`) hoje só:
- Cria o `agendamento` via edge `agendar-cliente`.
- Faz `UPDATE contatos SET pipeline_coluna_id = NULL` → some do CRM.
- O usuário acessa o histórico só via "Esteira Completa" (sub-tab no CRM), e o **card no Pipeline Lojas** é o agendamento — sem link visual rico para o atendimento de origem.

O usuário quer que, ao sair do CRM, o card **apareça no Pipeline de Lojas com o histórico da conversa anexado e clicável**.

### Correção
1. **Edge function nova `migrar-card-pipeline`** que executa atomicamente:
   - Busca atendimento ativo do contato (`atendimentos` aberto mais recente).
   - Cria `agendamento` (reusa lógica de `agendar-cliente` ou chama internamente).
   - Persiste `metadata.origem_crm = { atendimento_id, coluna_origem_id, coluna_origem_nome, transferido_at, transferido_por }` no agendamento.
   - Cria evento `pipeline_card_eventos` tipo `transferencia_crm_lojas` com referência cruzada (`entidade=agendamento`, `metadata.atendimento_id`, `metadata.coluna_anterior`).
   - Limpa `contatos.pipeline_coluna_id`.
2. **`AgendamentoDialog`** (card do Pipeline Lojas) ganha aba **"Conversa"** que:
   - Lê `metadata.origem_crm.atendimento_id` do agendamento.
   - Renderiza as `mensagens` daquele atendimento em modo leitura (timeline com bolhas), reutilizando o mesmo componente de bolha usado em `Atendimentos.tsx`.
   - Botão "Abrir conversa completa" leva para `/atendimentos?id={atendimento_id}`.
3. **`TransferPipelineDialog`** chama a nova edge em vez de fazer as duas operações soltas.
4. **Pipeline Lojas (`PipelineAgendamentos.tsx`)**: badge no card indicando "Veio do CRM" quando existe `metadata.origem_crm`, com tooltip do nome do atendente/coluna anterior.

## Detalhes técnicos

### Arquivos
- `supabase/migrations/<nova>.sql` — backfill dos 5 órfãos.
- `supabase/functions/agendamentos-cron/index.ts` — guardrail G2 + ajuste no filtro de processFirstStoreCharge.
- `supabase/functions/migrar-card-pipeline/index.ts` — **novo**.
- `supabase/config.toml` — registrar nova função (verify_jwt = false).
- `src/components/pipeline/TransferPipelineDialog.tsx` — trocar chamada para a nova edge.
- `src/components/agendamentos/AgendamentoDialog.tsx` — nova aba "Conversa" + carregamento de mensagens.
- `src/pages/PipelineAgendamentos.tsx` — badge "Veio do CRM".

### SQL backfill
```sql
-- Resgata os 5 órfãos com data passada
UPDATE agendamentos
SET status = 'no_show',
    metadata = metadata || jsonb_build_object('orfao_resgatado_at', now()::text)
WHERE status IN ('agendado','lembrete_enviado','confirmado')
  AND loja_confirmou_presenca IS NULL
  AND data_horario < now() - interval '24 hours';
```

Após aprovação, aplico backfill + edge nova + componentes em sequência.
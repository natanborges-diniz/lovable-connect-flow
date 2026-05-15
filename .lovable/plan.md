# Encerramento inteligente pós-retomada

## Situação atual
- `vendas-recuperacao-cron` já tem `MAX_TENTATIVAS = 2` (IA e humano) → manda no máximo 2 retomadas e depois dispara despedida + move pra "Perdidos". Isso já atende o caso "sem resposta".
- O que falta: quando o cliente **responde negativamente** à 1ª retomada (ex.: "não", "não quero", "depois eu vejo", "deixa pra lá", "fica pra depois", "não tenho interesse", "agora não"), o sistema não detecta isso como encerramento — então o cron pode mandar a 2ª retomada algumas horas depois, incomodando o cliente.
- O detector atual de despedida (`isShortNoToHelp`) só dispara depois da pergunta canônica "posso ajudar em mais alguma coisa?", o que não cobre resposta negativa a um template de retomada.

## Mudança proposta

### 1. `supabase/functions/ai-triage/index.ts` — detector "negativa pós-retomada"
Adicionar, junto ao bloco que monta `isExplicitClose / isThanksClose / isShortNoToHelp` (~linha 3825):

- Detectar se a última mensagem outbound foi um template de retomada (`recuperacao_vendas.ultima_tentativa_at` ou `recuperacao_humano.ultima_tentativa_at` nos últimos ~48h, sem inbound intermediário ≠ atual).
- Regex `NEGATIVA_POS_RETOMADA_RE` cobrindo: `^(não|nao|n)\b`, `não quero`, `não tenho interesse`, `não preciso`, `depois (eu )?vejo`, `deixa (pra|para) (depois|lá)`, `fica (pra|para) depois`, `agora não`, `talvez depois`, `obrigad[ao],? não`, `sem interesse`.
- Quando casar (e ainda não houver `nao_retornar_automaticamente`):
  - Disparar a mesma despedida determinística já usada (mensagem curta "Tudo bem! Qualquer coisa é só me chamar 👋"), sem perguntar mais nada.
  - Persistir em `atendimentos.metadata`:
    - `nao_retornar_automaticamente = true`
    - `encerrado_pelo_cliente_at = now`
    - `encerrado_motivo = "negativa_pos_retomada"`
  - `atendimentos.status = 'encerrado'`, `fim_at = now`.
  - Mover card para coluna "Perdidos" (mesmo helper já usado em `cancelar_visita`/despedida final).
  - Log `[CLOSE-NEGATIVA-RETOMADA]` + evento `despedida_negativa_pos_retomada`.

Isso entra **antes** do branch `cancelar_visita` / fluxo LLM, então a IA não tenta reengajar nem o cron envia a 2ª retomada (já que o flag bloqueia).

### 2. `supabase/functions/vendas-recuperacao-cron/index.ts`
- Nenhuma mudança lógica: `MAX_TENTATIVAS=2` já garante "no máximo 1 retomada adicional se ficar em silêncio", e o flag `nao_retornar_automaticamente` (criado no item 1) bloqueia novas tentativas após negativa.
- Apenas confirmar que `payload.max_tentativas` e `payload.humano_max_tentativas` no `cron_jobs` continuam em 2 (default já é 2; sem migração necessária a menos que estejam sobrescritos).

### 3. Memória
Atualizar `mem://ia/bloqueio-retomada-pos-encerramento.md` adicionando `negativa_pos_retomada` à lista de motivos válidos para `nao_retornar_automaticamente`.

### 4. Validação
- Deploy `ai-triage`.
- Conferir nos logs com cliente real: ao responder "não, depois eu vejo" após `retomada_contexto_1`, IA envia despedida curta, marca flag e o cron não dispara `retomada_contexto_2`.

## Fora de escopo
- Mexer em watchdogs (`watchdog-loop-ia`, `watchdog-inbound-orfao`) ou em `pipeline-automations`.
- Alterar a cadência de horas entre tentativas.

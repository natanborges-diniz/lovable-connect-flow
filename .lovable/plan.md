
## Problema observado

No diálogo da Fran (agendou às 16:55 para hoje 17:30), o sistema disparou DUAS mensagens "Oi Fran, ainda não conseguimos confirmar..." em sequência (16:59 e 17:00), mesmo após ela já ter confirmado verbalmente ("Sim", "obg"). Isso acontece porque hoje o `agendamentos-cron` tem três caminhos de lembrete sobrepostos:

1. **Fluxo A** (linha 49-67): transiciona qualquer agendamento de hoje/amanhã para `status=lembrete_enviado` com `tentativas_lembrete=1`, sem enviar mensagem. Mas a transição "consome" o slot da 1ª tentativa silenciosamente.
2. **Fluxo B — `processLembreteRetry`** (linha 234-281): envia "ainda não conseguimos confirmar" quando `tentativas_lembrete=1` e (passou `HORAS_REENVIO_LEMBRETE` desde update **OU** falta menos de 2h para o atendimento). Para a Fran, faltavam ~33min → disparou imediatamente, e duplicou porque dois ticks do cron rodaram antes do `tentativas_lembrete=2` ser persistido.
3. **Fluxo B2 — `processLembreteDiaD`** (linha 524): envia "Bom dia, passando pra lembrar..." às 08h SP do dia da visita.

Não há nenhuma checagem de "cliente já confirmou" e nem de "agendamento marcado com menos de Xh de antecedência → não mandar lembrete".

## Política nova (decisão do usuário)

| Caso | Lembrete |
|---|---|
| Agendamento para HOJE, marcado com ≥ 1h de antecedência | **1 único** lembrete, **1h antes** do horário |
| Agendamento para HOJE, marcado com < 1h de antecedência | **NENHUM** lembrete |
| Agendamento para dia futuro | **1 único** lembrete na **véspera** (08h SP do dia anterior) |
| Cliente já respondeu confirmando depois do agendamento | **NENHUM** lembrete adicional |

Sempre 1 lembrete máximo por agendamento. Sem reenvio. Sem segunda tentativa.

## Mudanças

### 1. `supabase/functions/agendamentos-cron/index.ts`

**Remover completamente:**
- Fluxo A atual (transição cega para `lembrete_enviado` 24h-48h antes) — ele pré-marca `tentativas_lembrete=1` sem nem enviar mensagem, gerando confusão e duplicação.
- Fluxo B `processLembreteRetry` (e a chamada na linha 72) — reenvio "ainda não conseguimos confirmar" deixa de existir.

**Substituir por dois fluxos novos e simples, idempotentes via `metadata.lembrete_enviado_at`:**

- **`processLembreteVespera`** — roda às 08h SP. Para cada agendamento com `data_horario` no dia seguinte, status em (`agendado`,`confirmado`), `loja_confirmou_presenca` nulo, sem `metadata.lembrete_enviado_at` e sem `metadata.cliente_confirmou_at`: envia 1 mensagem "Oi {nome}, passando pra confirmar sua visita amanhã às *{hora}* na *{loja}*. Posso confirmar?" via `send-whatsapp`, grava `metadata.lembrete_enviado_at` com lock atômico (mesmo padrão do `processLembreteDiaD` atual), atualiza `status='lembrete_enviado'` e `tentativas_lembrete=1`. Marca evento `lembrete_vespera_enviado` no CRM.

- **`processLembrete1hAntes`** — roda a cada 5 min. Para cada agendamento com `data_horario` entre `now+55min` e `now+65min` (janela tolerante de ~10min), mesmas guardas acima:
  - Calcula `created_at` ou `metadata.agendado_em` vs `data_horario`. Se a diferença for **< 60 min** (cliente marcou com <1h de antecedência), grava `metadata.lembrete_skip_motivo='janela_curta'` e segue sem enviar.
  - Caso contrário, envia "Oi {nome}, passando pra lembrar da sua visita hoje às *{hora}* na *{loja}*. Posso confirmar?" e segue o mesmo padrão de lock + evento `lembrete_1h_enviado`.

**Substituir `processLembreteDiaD` pelo `processLembrete1hAntes`** — o lembrete das 08h dia-D some, porque o usuário quer só 1h antes para o dia atual.

**Detecção "cliente já confirmou":** quando `whatsapp-webhook` ou `ai-triage` detecta confirmação do cliente (regex "sim/ok/confirmado/beleza" + agendamento ativo) e marca `agendamentos.status='confirmado'`, também gravar `metadata.cliente_confirmou_at = now()`. Os dois novos fluxos pulam qualquer agendamento que tenha esse campo. (Hoje só há `metadata.aviso_loja_enviado_at`, então adicionar essa flag é trivial.)

### 2. `supabase/functions/whatsapp-webhook/index.ts` e `supabase/functions/ai-triage/index.ts`

No ponto onde já marcam `status='confirmado'` e disparam `notificar-loja-agendamento` (já documentado em `mem://agendamentos/aviso-loja-pos-confirmacao`), adicionar no mesmo update do metadata: `cliente_confirmou_at: new Date().toISOString()`.

### 3. Memória

- Atualizar `mem://agendamentos/janela-comunicacao-e-d-day.md` (existe na lista) para refletir a nova regra: "1 lembrete; véspera para futuros, 1h antes para hoje, nada se <1h de antecedência".
- Atualizar `mem://agendamentos/cadencia-noshow-e-cobranca-loja.md` removendo qualquer referência a 2ª tentativa de lembrete.
- Adicionar entrada no `mem://index.md` Core: "Lembretes ao cliente: 1 único — véspera 08h ou 1h antes. <1h de antecedência → nenhum. Cliente que já confirmou nunca recebe."

### 4. Não mexer

- Cobrança à loja (`processFirstStoreCharge`, `processSecondStoreChargeNextMorning`, `processStoreTimeout`) — fluxo separado, continua como está.
- `notificar-loja-agendamento` — já é correto.
- Recuperação no-show / abandono — fluxo separado.

## Como verificar depois

1. Criar agendamento para hoje com `data_horario` faltando 30min → não deve disparar lembrete; evento `lembrete_skip_motivo=janela_curta` no CRM.
2. Criar agendamento para hoje faltando 2h → 1 lembrete chega quando faltar ~1h.
3. Criar agendamento para amanhã → 1 lembrete às 08h de hoje.
4. Cliente responde "sim" antes do horário do lembrete → nenhuma mensagem dispara.
5. Cron rodando 5min depois do lembrete enviado → não duplica (lock via `metadata.lembrete_enviado_at`).

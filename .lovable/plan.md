## Suporte completo a mensagens interativas WhatsApp (botões + listas)

Implementação nova em 3 camadas + cron. Tudo determinístico por `button_id`, eliminando regex e LLM nos pontos de decisão.

---

### CAMADA 1 — `supabase/functions/send-whatsapp/index.ts`

Adicionar campo opcional `interactive` no body:

```ts
interactive?: {
  type: "button" | "list";
  texto: string;
  botoes?: Array<{ id: string; titulo: string }>;            // máx 3, title ≤20 chars
  lista?: {
    label: string;                                            // ≤20 chars
    secao: string;
    itens: Array<{ id: string; titulo: string; descricao?: string }>; // máx 10
  };
}
```

Nova função `sendInteractiveViaMeta(phone, interactive)` que monta o payload Meta `type:"interactive"` (button ou list). Truncar `title` em 20, `description` em 72, `body.text` em 1024 conforme limites Meta.

Mantém:
- Guard de 24h (interativas também só dentro da janela — fora exige template).
- Validação de telefone.
- Persistência em `mensagens` com `tipo_conteudo: "interactive"`, `conteudo` = `interactive.texto`, e `metadata.interactive` = payload original (para auditoria/render no Atrium).

Ordem de prioridade no handler: `interactive` > `media_url` > `texto`.

---

### CAMADA 2 — `supabase/functions/whatsapp-webhook/index.ts`

No parser onde `msg.type` é avaliado, adicionar:

```ts
if (msg.type === "interactive") {
  const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
  if (reply) return {
    tipo_conteudo: "interactive_reply",
    text: reply.title,                  // mantém compat com pipeline atual
    interactive_reply: true,
    button_id: reply.id,
    button_title: reply.title,
  };
}
```

Ao salvar em `mensagens`:
- `conteudo` = `reply.title` (compat com IA legível e timeline)
- `tipo_conteudo` = `"interactive_reply"`
- `metadata.interactive_reply = true`
- `metadata.button_id = reply.id`

Propagar `button_id` para o invoke do `ai-triage` no payload (campo novo `button_id`).

---

### CAMADA 3 — `supabase/functions/ai-triage/index.ts`

#### 3.1 — Helper `sendInteractive(phone, atendimentoId, interactive)`
Wrapper sobre `supabase.functions.invoke("send-whatsapp", { body: { atendimento_id, interactive } })`. Loga `[INTERACTIVE] sent type=… buttons=…`.

#### 3.2 — Router determinístico por `button_id` (TOPO do handler)
Antes de `classifyIntent`/`deterministicIntentFallback`/LLM, se `payload.button_id` (ou `mensagem.metadata.button_id`) estiver presente:

```ts
const BUTTON_HANDLERS: Record<string, (ctx) => Promise<Resp>> = {
  // Triagem
  orcamento:        ctx => handleOrcamentoStart(ctx),
  status_pedido:    ctx => escalateToOS(ctx),
  duvida:           ctx => handleDuvidaLivre(ctx),
  reclamacao:       ctx => escalateToHuman(ctx, "reclamacao"),
  agendar:          ctx => startAgendamentoFlow(ctx),

  // Receita
  receita_foto:     ctx => askForReceitaPhoto(ctx),
  receita_digitar:  ctx => sendMsgFixa(ctx, "MSG_PEDIR_RECEITA_TEXTO"),
  receita_sem:      ctx => handleSemReceita(ctx),
  receita_ok:       ctx => runConsultarLentesFromMetadata(ctx),
  receita_corrigir: ctx => sendMsgFixa(ctx, "MSG_PEDIR_RECEITA_TEXTO"),

  // Adicionais
  adicional_azul:   ctx => continueQuoteWith(ctx, { filtro_blue: true }),
  adicional_foto:   ctx => continueQuoteWith(ctx, { filtro_photo: true }),
  adicional_nao:    ctx => continueQuoteWith(ctx, {}),

  // Reação ao orçamento
  orcamento_agendar:      ctx => startAgendamentoFlow(ctx),
  orcamento_duvida:       ctx => handleDuvidaLivre(ctx),
  orcamento_mais_barato:  ctx => offerDiscount(ctx),

  // Desconto
  desconto_aceito: ctx => startAgendamentoFlow(ctx),
  desconto_loja:   ctx => sendEnderecosLojas(ctx),
  desconto_pensar: ctx => sendDespedidaCordial(ctx),

  // Cidade/loja (id = loja_id) — prefixo loja:<uuid>
  // tratado por match prefixo, não na map

  // Confirmação agendamento
  ag_confirmar: ctx => callAgendarVisita(ctx),
  ag_mudar:     ctx => askNovaDataHora(ctx),
  ag_cancelar:  ctx => cancelarAgendamentoPending(ctx),

  // Dia-D
  show_confirma: ctx => confirmarPresencaDiaD(ctx),
  show_remarcar: ctx => startReagendamentoFlow(ctx),
  show_nao:      ctx => cancelarEReoferecer(ctx),

  // Recuperação no-show
  recupera_sim:  ctx => startAgendamentoFlow(ctx),
  recupera_loja: ctx => sendEnderecosLojas(ctx),
  recupera_nao:  ctx => marcarNegativaPosRetomada(ctx),
};
```

Se `button_id` casar, executa handler e retorna — sem LLM, sem regex.

Prefixo especial `loja:<uuid>` (lista de lojas) → salva `loja_id` em `atendimento.metadata.agendamento_pending.loja_id` e avança para escolha de data.

#### 3.3–3.10 — 8 pontos de envio interativo

Substituir os pontos atuais de texto livre por chamadas a `sendInteractive`:

| # | Gatilho atual | Substituição |
|---|---------------|--------------|
| 1 | Triagem após confirmar nome (`inboundCount===2`) | Lista "Como posso te ajudar hoje?" com 5 itens |
| 2 | 1ª solicitação de receita | Botões `receita_foto / receita_digitar / receita_sem` |
| 3 | Pós-`interpretar_receita` OCR, antes de cotar | Botões `receita_ok / receita_corrigir` (snapshot da receita em `metadata.receita_pending`) |
| 4 | Após confirmar receita, antes de `consultar_lentes` | Botões `adicional_azul / adicional_foto / adicional_nao` |
| 5 | Junto com o orçamento renderizado | Botões `orcamento_agendar / orcamento_duvida / orcamento_mais_barato` |
| 6 | Após oferecer desconto 20% | Botões `desconto_aceito / desconto_loja / desconto_pensar` |
| 7 | Quando pediria cidade | Lista carregada de `telefones_lojas` (tipo=loja, ativo) — id=`loja:<uuid>`, descricao=endereço |
| 8 | Antes de chamar `agendar_visita` | Botões `ag_confirmar / ag_mudar / ag_cancelar` |

Para cada ponto que hoje envia texto, manter fallback: se Meta retornar erro 4xx no interactive, fazer retry como texto simples.

#### Estado pendente
Persistir em `atendimento.metadata`:
- `receita_pending` — receita interpretada aguardando `receita_ok`
- `adicionais_pending` — guarda args parciais de cotação
- `agendamento_pending` — `{ loja_id, loja_nome, data, hora }` aguardando `ag_confirmar`

---

### CAMADA 4 — `supabase/functions/agendamentos-cron/index.ts`

#### Ponto 9 — Lembretes dia-D
Onde hoje envia `lembrete_vespera` e `lembrete_1h` (texto/template), trocar para `sendInteractive` com botões `show_confirma / show_remarcar / show_nao`. Se estiver fora da janela 24h, manter template (botões não passam em template arbitrário — só templates com `BUTTONS` cadastrados na Meta funcionariam; usar texto interativo apenas se dentro da janela).

#### Ponto 10 — Recuperação pós-no-show
Nas 3 tentativas de recuperação, mesma substituição: botões `recupera_sim / recupera_loja / recupera_nao` quando dentro da janela 24h.

**Importante:** O no-show é disparado pela loja via app InFoco Messenger (projeto cross). Não muda o gatilho — apenas a forma da mensagem ao cliente final.

---

### Renderização no Atrium (UI interna)

`src/components/atendimentos/` — adicionar render para `tipo_conteudo === "interactive"` (mostra texto + lista visual dos botões/itens que foram enviados) e `tipo_conteudo === "interactive_reply"` (badge indicando "Cliente tocou em: {titulo}"). Mínimo viável — sem componente novo, só ajuste no balão atual.

---

### Memórias

Criar `mem://ia/whatsapp-interativo-determinismo.md` com:
- Map completo `button_id → handler`
- Regra: nunca usar regex/LLM quando `button_id` presente
- Limites Meta (3 botões, 10 itens lista, 20 chars title)
- Guard 24h também vale para interactive

Atualizar `mem://index.md` Core:
> "Confirmações e escolhas usam botões/listas WA quando dentro da 24h. button_id é determinístico — nunca passar por regex/LLM."

Atualizar referência aos pontos modificados em:
- `pos-agendamento-silencio.md` (ag_confirmar)
- `auto-receita-e-anti-loop.md` (receita_ok bypassa loop)
- `agendamento-ativo-anti-duplicacao.md` (show_confirma idempotente)

---

### Deploy

Funções a redeployar:
- `send-whatsapp`
- `whatsapp-webhook`
- `ai-triage`
- `agendamentos-cron`

### Validação

1. `curl` em `send-whatsapp` com `interactive: { type: "button", … }` → confirmar 200 e payload Meta correto.
2. Simular webhook Meta com `interactive.button_reply` → confirmar `mensagens.metadata.button_id` populado e `ai-triage` invocado.
3. Trigger manual `ai-triage` com `button_id: "orcamento"` → confirmar bypass de LLM e envio dos botões de receita.
4. Verificar logs: `[INTERACTIVE] sent` e `[BUTTON ROUTER] hit id=…` em todas execuções.

### Escopo

- Não toca em fluxo de templates fora-janela (continuam texto puro).
- Não cria tabela nova — usa `atendimento.metadata` para estado pendente.
- Não muda esquema de tools do LLM — apenas redireciona quando há `button_id`.
- B2B/InFoco Messenger não recebe botões (só clientes finais via Meta).

# Bug: Gael disse "cancelei" mas o agendamento ficou ativo

## O que aconteceu na conversa da Franciana (5584994244323)

1. 16:31 — Cliente: "Não. Vou ter que desmarcar."
2. 16:33 — Gael: "Posso cancelar agora seu horário…?"
3. 16:35 — Cliente: "Pode."
4. 16:36 — Gael: "Prontinho, Fran — cancelei seu horário…" **← apenas texto. Nenhuma tool foi chamada.**
5. 17:46 — Cliente: "Não. Obg." → dispara **despedida determinística**, que lê o `agAtivoRecent` (status `lembrete_enviado`) e assina "Te espero sexta-feira, 15/05 às 17:30 na DINIZ PRIMITIVA I 👋".

## Causa raiz

Verifiquei `supabase/functions/ai-triage/index.ts` e o registro `agendamentos.id=e595e7dd-4881-4816-97d6-7b75d8d9b4e7` (contato 90ddecb2 = "Fran"):

- Tools disponíveis: `responder, escalar_consultor, interpretar_receita, agendar_visita, reagendar_visita, consultar_lentes, consultar_lentes_estimativa, consultar_lentes_contato, registrar_nome_cliente, agendar_lembrete`.
- **Não existe `cancelar_visita`/`cancelar_agendamento`.**
- O agendamento permanece `status=lembrete_enviado`, sem `metadata.cancelado_em`.
- A despedida determinística (linhas 3866–3937) só ignora agendamento "passado quando há outro futuro" — agendamento ainda ativo do mesmo dia continua sendo assinado.
- Pior: o template `retomada_contexto_1` foi disparado às 17:45 pelo `vendas-recuperacao-cron` porque a conversa ficou aberta sem cliente_confirmou_at e sem cancelamento.

## Correção proposta

### 1. Nova tool `cancelar_visita` em `ai-triage/index.ts`

Schema (similar a `reagendar_visita`):
```
{ name: "cancelar_visita",
  description: "Cancela o agendamento ativo do cliente quando ele pede explicitamente para cancelar/desmarcar sem remarcar agora.",
  parameters: { motivo?: string } }
```

Executor:
- Busca `agAtivoRecent` (mesma lógica já existente).
- `UPDATE agendamentos SET status='cancelado', updated_at=now(), metadata = metadata || jsonb_build_object('cancelado_em', now(), 'cancelado_por','cliente_via_ia','cancelado_motivo', motivo)`.
- Loga `eventos_crm.tipo='agendamento_cancelado_cliente'`.
- Resposta padrão: "Prontinho, {nome} — cancelei seu horário de {dataFmt} na {loja}. Quando quiser remarcar é só me chamar 👋".

Idempotência: se já está cancelado, retorna sucesso sem reescrever.

### 2. Hint pré-LLM: forçar `cancelar_visita`

Na seção `explicitChange` (linha ~4441) que já detecta `cancelar`, adicionar branch:

- Se há `agAtivoRecent` E última mensagem do cliente é confirmação curta (`pode|pode sim|sim|ok|confirmo|cancela|pode cancelar`) E o último outbound do assistant ofereceu cancelamento (regex `cancelar (agora|seu (hor[áa]rio|agendamento))|deixar para remarcar depois`), injetar `tool_choice` forçado para `cancelar_visita` em vez de deixar o LLM responder em texto livre.

- Se cliente diz `desmarcar|cancelar|não vou conseguir ir` sem pedir remarcação imediata (e sem mencionar nova data), injetar hint orientando a usar `cancelar_visita` e perguntar depois se quer remarcar.

### 3. Salvaguarda na despedida determinística

Em `agAtivoRecent` (linha ~3822–3872), excluir agendamentos cujo último outbound do assistant nos últimos 30 min contenha `cancelei seu (hor[áa]rio|agendamento)` — evita reincidência caso a tool falhe. Loggar `[FAREWELL] agendamento descartado por evidência textual de cancelamento`.

### 4. Memória do projeto

Adicionar `mem://ia/cancelar-visita-tool.md` documentando: tool nova, regras de disparo (cliente confirma cancelamento explícito), interação com `vendas-recuperacao-cron` (agendamento cancelado não dispara mais retomada via lembrete dia-D nem assinatura na despedida).

### 5. Recompilar prompt

Após editar a tool list, rodar `compile-prompt` para que `prompt_atendimento` reflita a nova capacidade nos exemplos/instruções.

## Fora de escopo

- Não vou mexer em `agendamentos-cron` nem em `vendas-recuperacao-cron` agora — assim que o `status=cancelado` for gravado corretamente, ambos já filtram fora (já validei nos arquivos das memórias `agendamentos/janela-comunicacao-e-d-day` e `crm/recuperacao-ia-anti-abandono`).
- Não corrigir o registro da Franciana retroativamente — fora do escopo do bug. (Posso fazer separadamente se você pedir: `UPDATE agendamentos SET status='cancelado'` no id `e595e7dd-…`.)

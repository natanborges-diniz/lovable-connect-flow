# Bloquear agendamentos em dias que a loja está fechada

## Diagnóstico

No diálogo do Jorge (Osasco), a IA ofereceu **domingo 11h ou 15h** na "Diniz Antônio Agú (Centro)" — uma loja de rua que **não abre aos domingos**. A infraestrutura de horários por dia da semana (`horarios_semana`) e a função `loja_status_no_dia` já existem e estão populadas, mas **nada disso é consultado** hoje:

- `ai-triage/index.ts` (linhas 1761 e 1876/1940) lê apenas `horario_abertura`/`horario_fechamento` (par único legado) ao montar o prompt das lojas. A IA não tem como saber que aquela loja fecha dom.
- `agendar-cliente/index.ts` cria o agendamento sem checar se a loja abre na data.
- Resultado: a IA "alucina" horários plausíveis em dias fechados, e o agendamento é gravado mesmo assim.

## O que vai mudar

### 1. `ai-triage` — injetar status real do dia no prompt

Ao montar o bloco "LOJAS DISPONÍVEIS" (tanto no caminho compiled quanto legacy), para cada loja chamar `loja_status_no_dia(loja_id, data)` para **hoje, amanhã e depois**. Substituir a linha única `Horário: 09:00-19:00` por uma grade dos próximos 3 dias, ex.:

```text
- **Diniz Antônio Agú (Centro)** | R. Antônio Agú, 681
  Hoje (sáb 03/05): 09:00–18:00
  Amanhã (dom 04/05): FECHADA
  Seg 05/05: 09:00–19:00
```

Adicionar instrução explícita no prompt:
> **Nunca ofereça horário num dia marcado como FECHADA.** Se o cliente pedir um dia em que a loja está fechada, diga que aquela loja não abre nesse dia e ofereça (a) outra data ou (b) outra loja que abra.

Onde a IA já mostra "horário 09:00-19:00", trocar por essa grade calculada.

### 2. `agendar-cliente` — validação dura antes de criar

Antes do `INSERT` em `agendamentos`:

1. Resolver `loja_id` a partir de `loja_nome` (ILIKE em `telefones_lojas`).
2. Chamar `loja_status_no_dia(loja_id, data::date)`.
3. Se `aberta = false`: **abortar**, registrar evento `agendamento_dia_fechado` em `eventos_crm` e devolver erro estruturado para a IA reformular:
   ```json
   { "error": "loja_fechada_no_dia", "motivo": "feriado_nacional_total" | "dia_fechado" | ..., "loja_nome": "...", "data": "YYYY-MM-DD" }
   ```
4. Se `aberta = true` mas a `hora` cair fora de `[abre, fecha]`: também abortar com `error: "fora_do_horario"`, devolvendo `abre`/`fecha` para a IA propor um slot válido.

### 3. `ai-triage` — tratar erro e refazer

No bloco que processa o retorno de `agendar-cliente`, se vier `error: loja_fechada_no_dia` ou `fora_do_horario`:
- **Não** confirmar agendamento ao cliente.
- Reinjetar o erro como observação de sistema na próxima iteração da tool, com instrução para oferecer outro dia/loja.
- Logar `eventos_crm` tipo `agendamento_recusado_horario`.

### 4. `agendamentos-cron` (lembretes/confirmações)

Antes de disparar lembrete/confirmação, validar se a loja realmente abre na `data_horario`. Se não, gerar evento `agendamento_em_dia_fechado` para revisão humana e **não** enviar a mensagem ao cliente. (Salvaguarda contra agendamentos antigos criados antes desta correção.)

### 5. UI — alerta no card do agendamento

Em `AgendamentoDialog.tsx` (criação/edição manual): ao escolher data e loja, chamar `loja_status_no_dia` e mostrar badge vermelho "Loja fechada nesta data — motivo: ..." bloqueando o salvar até trocar data ou loja.

## Detalhes técnicos

- A função `public.loja_status_no_dia(_loja_id uuid, _data date)` já retorna `{ aberta, abre, fecha, motivo, feriado_nome?, dia? }`. Vai ser chamada via `supabase.rpc("loja_status_no_dia", { _loja_id, _data })`.
- Em `ai-triage`, fazer um único batch: `Promise.all` para 3 dias × N lojas, com cache em memória durante a request.
- Em `agendar-cliente`, a validação é uma única chamada RPC + comparação de horas; ~5ms de overhead.
- Lojas sem `horarios_semana` populado já recebem fallback `dia_fechado` da função — verificar no backfill se todas têm o JSON; se não, completar.

## Não está no escopo

- Não vamos mexer em `bot-lojas` agora (fluxos B2B internos não dependem de horário de loja física).
- Não vamos adicionar UI de feriados além da que já existe (`FeriadosCard`).

## Pontos a confirmar

1. **Quantos dias para frente** mostrar no prompt da IA? Sugestão: **hoje + 6 (1 semana)** para dar repertório, mas só listar os abertos, marcando os fechados de forma compacta.
2. Quando a IA detectar "loja fechada no dia que cliente pediu", devo **sugerir automaticamente Shopping União/Super Shopping** se eles estiverem abertos naquele dia (regra de negócio: shoppings abrem dom 14–20)?
3. Para agendamentos antigos já gravados em dia fechado (caso existam), devo gerar uma lista para revisão humana via evento `eventos_crm`, ou só aplicar a regra para novos?

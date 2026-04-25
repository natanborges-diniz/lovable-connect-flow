## Bugs no fluxo de agendamento e lembretes

Diagnóstico do diálogo do Artur (agendamento DINIZ PRIMITIVA I):

| Sintoma | Causa-raiz |
|---|---|
| Cliente combina 17:00, IA grava 20:00 no banco | `ai-triage` chama `agendar_cliente` com `data_horario` divergente do horário citado na resposta — sem validação de coerência |
| 2 lembretes idênticos "Bom dia" às 08:00 | `processDayDReminder` lê `metadata.lembrete_dia_d_at` como guarda, mas o UPDATE não é atômico → cron de 5 min pode disparar 2x antes do metadata persistir |
| Mensagem "ainda não conseguimos confirmar..." às 02:10 da madrugada | `processLembreteRetry` não respeita janela horária de comunicação com cliente |
| Lembrete enviado para visita de 20:00 num sábado em loja que fecha 19h | Cron D-Day não valida se o horário do agendamento está dentro do expediente da loja |

### Correções

**1. `supabase/functions/ai-triage/index.ts` — coerência horário tool ↔ resposta**

No handler da tool `agendar_cliente`/`reagendar_visita` (linha ~2790):
- Antes de chamar `agendar-cliente`, extrair o horário mencionado em `args.resposta` via regex (`\b(\d{1,2})[h:](\d{0,2})`) e comparar com a hora de `args.data_horario` em SP.
- Se divergir em mais de 0 min, **abortar** a tool, logar `eventos_crm` tipo `agendamento_horario_divergente` e responder pedindo confirmação ("Só pra confirmar: foi às 17h ou 20h?").
- Reforçar a descrição da tool no schema: "Use EXATAMENTE o horário que o cliente confirmou na última mensagem. Nunca arredonde, nunca improvise."

**2. `supabase/functions/agendamentos-cron/index.ts` — D-Day idempotente atômico**

Substituir o padrão `select → check metadata → update` por **lock por linha** antes de enviar:
```ts
const { data: locked } = await supabase
  .from("agendamentos")
  .update({ metadata: { ...md, lembrete_dia_d_at: new Date().toISOString() } })
  .eq("id", ag.id)
  .is("metadata->>lembrete_dia_d_at", null)  // só atualiza se ainda não foi enviado
  .select("id")
  .maybeSingle();
if (!locked) continue; // outro worker já pegou
// só então envia o WhatsApp
```
Marcar `lembrete_dia_d_at` ANTES do envio elimina o duplicado mesmo com cron de 5 min.

**3. `supabase/functions/agendamentos-cron/index.ts` — janela de comunicação ao cliente**

Adicionar guard global em `processLembreteRetry` e em qualquer envio outbound de lembrete/cobrança ao cliente:
```ts
function dentroDeJanelaComunicacaoCliente(now: Date): boolean {
  const sp = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const h = sp.getHours();
  return h >= 8 && h < 21;  // 08:00-21:00 SP
}
```
Fora dessa janela: pula o ciclo (a próxima execução do cron pega quando entrar na janela). Isso corta os disparos de madrugada.

**4. `supabase/functions/agendamentos-cron/index.ts` — validar expediente da loja no D-Day**

No `processDayDReminder`, antes de enviar:
- Buscar `horario_abertura`/`horario_fechamento` em `telefones_lojas` pelo `loja_nome`.
- Se `data_horario` SP estiver fora do expediente OU em domingo (loja fechada), não envia o lembrete. Em vez disso, registra `eventos_crm` tipo `agendamento_horario_invalido` e marca o card para revisão humana (passar `atendimento.modo = 'humano'` ou criar tarefa).

### Não muda

- Estrutura da tabela `agendamentos`.
- Janela humana já implementada (Seg-Sex 09-18, Sáb 08-12) — segue só para escalonamento; comunicação automática de lembrete usa janela 08-21 mais permissiva.
- Restante do `agendamentos-cron` (cobrança loja, no-show, recuperação).

### Memória

Atualizar `mem://agendamentos/fluxo-e-automacoes-temporais` adicionando: janela 08-21 para comunicação outbound ao cliente; lock atômico no D-day; validação de expediente da loja antes do lembrete.

### Deploy

Após edição, redeploy de `ai-triage` e `agendamentos-cron`.

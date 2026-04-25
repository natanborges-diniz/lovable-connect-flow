## Objetivo

No dia do agendamento, às **8h (America/Sao_Paulo)**, retomar o WhatsApp do cliente com um lembrete amigável da visita. Se o cliente confirmar, responder com mensagem de boas-vindas (sem novas perguntas). Se pedir para remarcar, oferecer novas datas/horários e reabrir o fluxo de agendamento.

---

## O que muda

### 1. Novo estágio de lembrete: `lembrete_dia_d` (08h)

O cron `agendamentos-cron` hoje só dispara um lembrete genérico ~24h antes (status `lembrete_enviado`) e depois cobra a loja. Vou adicionar um **novo bloco** que, entre 08:00–08:14 horário de São Paulo, varre agendamentos ativos do dia e envia uma mensagem padronizada via WhatsApp ao cliente.

- Janela: roda de hora em hora; só dispara se hora SP == 8 e ainda não houve lembrete-do-dia.
- Filtro: `data_horario` cai no dia de hoje (SP), `status` ∈ `agendado | lembrete_enviado | confirmado`, `loja_confirmou_presenca IS NULL`.
- Idempotência: usar `metadata.lembrete_dia_d_at` no agendamento para não reenviar.
- Envio via `send-whatsapp` reusando o `atendimento_id` do agendamento. Se não houver atendimento aberto, pular silenciosamente (sem reabrir conversa fora da janela 24h da Meta — caso comum porque o atendimento foi encerrado: então usar template HSM `lembrete_visita_dia` se existir; senão registrar evento e pular).

**Mensagem (texto livre, quando atendimento aberto):**
> "Bom dia, {primeiro_nome}! 👋 Passando pra lembrar da sua visita hoje às {hora} na *Diniz {loja}*. Posso confirmar que você vem? Se preferir remarcar, é só me dizer 😉"

### 2. Tratamento das respostas em `ai-triage`

Adicionar na camada de pré-LLM (já existe a detecção de "agendamento ativo"):

- Se houver `metadata.lembrete_dia_d_at` recente (< 24h) E o último inbound contiver confirmação (`sim|confirmo|vou|tô indo|ok|combinado|beleza|pode deixar|estarei`), responder de forma determinística:
  > "Maravilha, {nome}! 🙌 Nosso consultor já fica te aguardando com muito entusiasmo. Até daqui a pouco!"
  E marcar `agendamentos.status = 'confirmado'` + `metadata.confirmado_pelo_cliente_at`.

- Se o inbound contiver pedido de remarcação (`remarcar|reagendar|mudar|outro dia|outro horário|não vou conseguir|não consigo|cancelar`), **suspender o guardrail anti-duplicação** já existente para este turno e devolver controle ao LLM com hint: *"Cliente pediu para remarcar. Ofereça 2-3 opções de dia/horário próximas e use a tool agendar_visita após a confirmação."* O `agendar-cliente` já é idempotente; quando criar novo agendamento ele atualiza o existente em vez de duplicar (regra atual: mesmo contato + janela ±24h ≠ → considerado novo).

- Caso a mensagem seja ambígua, deixar o LLM responder com o hint padrão de "lembrete-do-dia em curso".

### 3. Documentar na memória

Atualizar `mem://agendamentos/fluxo-e-automacoes-temporais` adicionando o passo "Lembrete D-Day 08:00" e suas regras de resposta.

---

## Arquivos a alterar

- `supabase/functions/agendamentos-cron/index.ts` — novo helper `processLembreteDiaD()` e chamada no fluxo principal.
- `supabase/functions/ai-triage/index.ts` — bloco de detecção de "lembrete-do-dia respondido" antes do LLM.
- `.lovable/memory/ia/agendamento-ativo-anti-duplicacao.md` — adicionar exceção para "remarcar após lembrete-do-dia".
- `mem://agendamentos/fluxo-e-automacoes-temporais` — adicionar etapa.

Sem mudanças de schema — uso `agendamentos.metadata` (jsonb) que já existe.

---

## Casos cobertos

| Situação | Comportamento |
|---|---|
| Cliente confirma ("sim/vou") | Resposta automática de boas-vindas + status → `confirmado` |
| Cliente pede para remarcar | LLM oferece novas datas; ao escolher, `agendar_visita` atualiza o agendamento |
| Cliente não responde | Fluxo segue normal (cobrança da loja após horário) |
| Atendimento já encerrado / janela 24h Meta expirou | Pular envio livre; registrar evento `lembrete_dia_d_skip_window` (futuro: usar template HSM) |
| Já enviado hoje | `metadata.lembrete_dia_d_at` impede reenvio |

---

## Não vou fazer agora

- Criar template HSM novo na Meta (`lembrete_visita_dia`) — quando o atendimento estiver fora da janela de 24h, hoje só registramos evento. Posso criar em seguida se você quiser.
- Mudar o lembrete D-1 (24h antes) existente — segue como está.

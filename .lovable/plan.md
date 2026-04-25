## Ajustes nas mensagens do lembrete D-Day

Dois pequenos retoques de texto, sem mudar fluxo nem lógica.

### 1. Mensagem do lembrete (cron)

Arquivo: `supabase/functions/agendamentos-cron/index.ts` (linha 438)

Hoje:
> Bom dia, {nome}! 👋 Passando pra lembrar da sua visita hoje às *{hora}* na {loja}. Posso confirmar que você vem? **Se preferir remarcar, é só me dizer 😉**

Novo (sem mencionar remarcação — só pergunta se confirma):
> Bom dia, {nome}! 👋 Passando pra lembrar da sua visita hoje às *{hora}* na {loja}. Posso confirmar que você vem?

A oferta de remarcar continua existindo no fluxo, mas só dispara se o cliente **não confirmar** / pedir para remarcar (a detecção de `isDiaDReschedule` no `ai-triage` permanece igual, já trata "remarcar / não consigo / outro dia").

### 2. Mensagem de confirmação (ai-triage)

Arquivo: `supabase/functions/ai-triage/index.ts` (linha 3053)

Hoje:
> Maravilha, {nome}! 🙌 Nosso consultor já fica te aguardando **com muito entusiasmo**. Até daqui a pouco!

Novo (remove "entusiasmo", ajusta verbo):
> Maravilha, {nome}! 🙌 Nosso consultor estará te aguardando! Até daqui a pouco!

A atualização do agendamento para status `confirmado` + log `agenda_confirmado` já acontece logo após essa resposta — permanece como está.

### Deploy

Após os ajustes, redeploy de `agendamentos-cron` e `ai-triage`.

### Memória

Atualizar `mem://agendamentos/fluxo-e-automacoes-temporais` para registrar:
- Lembrete D-Day **não menciona remarcação** proativamente.
- Oferta de remarcar é **reativa** (somente se cliente sinalizar não-confirmação).
- Mensagem padrão de confirmação fixada (sem "entusiasmo").
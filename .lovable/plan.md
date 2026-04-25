## Janela de horário humano (escalonamento fora do expediente)

Gael continua atendendo 24/7 normalmente. A regra entra em ação **apenas no momento da escalada para humano**: se for fora do horário comercial, o cliente recebe aviso de que o humano retornará no próximo expediente.

### Regra de negócio

**Horário humano (timezone America/Sao_Paulo):**
- Segunda a sexta: 09:00 – 18:00
- Sábado: 08:00 – 12:00
- Domingo: fechado

**Comportamento na escalada (`atendimento.modo` → `humano`):**

- **Dentro do horário** → fluxo atual (mensagem padrão de transferência, fila humana absorve).
- **Fora do horário** → mensagem específica:
  > "Vou acionar nossa equipe pra você! 🙌 Só um detalhe: nosso time humano atende {dias_horario}. Como estamos fora do horário agora, assim que abrir o próximo expediente ({proxima_abertura}), eles te respondem por aqui. Pode deixar registrado o que precisa que já encaminho. 😉"
  
  - `{proxima_abertura}` calculado dinamicamente (ex.: "amanhã às 09:00", "segunda às 09:00", "hoje às 09:00" se for madrugada de dia útil).
  - Card vai pra fila humana normalmente — só muda a comunicação ao cliente.

### Onde aplicar

**1. `supabase/functions/ai-triage/index.ts`**
- Criar helper `isHorarioHumano()` e `proximaAberturaHumana()` (puro, em America/Sao_Paulo).
- No ponto onde `precisa_humano = true` ativa a escalada (e onde o cliente pede humano explicitamente), checar horário:
  - Se dentro: comportamento atual.
  - Se fora: substituir a mensagem de transferência pela versão "fora de expediente" com a próxima abertura calculada.
- Registrar evento `eventos_crm` com tipo `escalada_fora_horario` para visibilidade.

**2. `supabase/functions/watchdog-loop-ia/index.ts`**
- Quando o watchdog escalar por loop, também enviar uma mensagem discreta ao cliente; aplicar a mesma regra de horário (dentro = silencioso como hoje; fora = pequeno aviso de que humano responde no próximo expediente).

### Não muda

- Bot-lojas (corporativo) — segue 24/7.
- IA segue respondendo normalmente em qualquer horário.
- Lembretes D-Day, agendamentos-cron, recuperação — sem alteração.
- Coluna do CRM / fila humana — sem alteração; card aparece igual.

### Memória

Atualizar `mem://atendimento/modos-operacionais-ia-humano-hibrido` adicionando a janela de expediente humano e o comportamento de escalada fora do horário. Criar `mem://atendimento/horario-comercial-humano` com os horários canônicos.

### Deploy

Após edição: redeploy de `ai-triage` e `watchdog-loop-ia`.

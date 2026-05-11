## Problema

Quando o cliente pede explicitamente "Quero falar com atendente" (como o Roberto às 19:11, fora do expediente Seg-Sex 09–18), a IA responde com:

> "Entendido! Já acionei um Consultor especializado para te atender. Ele entrará em contato em breve…"

Sem avisar que o atendimento humano está fora do horário. O memory `horario-comercial-humano` exige que TODA escalada use `mensagemEscaladaForaHorario()` fora do expediente, mas a função `handleEscalation` (em `supabase/functions/ai-triage/index.ts`, linha 6365) é o único caminho de escalada que ainda usa string hardcoded, ignorando `isHorarioHumano()`.

Esse caminho é acionado pelo router de keywords ("falar com atendente", "quero atendente", "consultor especializado", etc. — definido por volta da linha 355) e dispara em `linha 2146`.

## Mudança

Em `handleEscalation` (linha 6365–6372):

1. Aceitar `nomePrim` como parâmetro opcional (ou buscar de `contatos.nome` via `contatoId` quando não fornecido — já temos `supabase` no escopo).
2. Substituir a string fixa por:
   ```ts
   const resposta = trigger === "lentes_de_contato"
     ? mensagem
     : (isHorarioHumano()
         ? "Entendido! Já acionei um Consultor especializado para te atender. Ele entrará em contato em breve. Posso te ajudar com algo rápido enquanto isso? 😊"
         : mensagemEscaladaForaHorario(nomePrim));
   ```
3. No único chamador (linha 2146), passar o primeiro nome (já existe `_np`/`nomePrim` computado várias vezes no arquivo; usar a mesma derivação local).
4. Registrar `fora_horario: !isHorarioHumano()` + `proxima_abertura` no `eventos_crm.metadata` da escalada (mesmo padrão de linhas 2683/5399), para auditoria.

## Validação

- Mensagem "quero falar com atendente" enviada 19:11 SP → resposta começa com "Olá {nome}! Nossos consultores estão fora do expediente…" + próxima abertura.
- Mesma mensagem enviada 14:00 SP → resposta atual mantida ("Já acionei um Consultor…").
- `atendimentos.modo='humano'` continua sendo setado nos dois casos (handoff hard preserva).
- `eventos_crm` registra `fora_horario` no payload.

## Arquivos

- `supabase/functions/ai-triage/index.ts` — patch em `handleEscalation` + ajuste do call site (linha 2146).

Sem migração, sem novos secrets.

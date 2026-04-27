---
name: Oftalmologista — clínicas parceiras + visita à loja
description: Quando cliente pergunta por oftalmologista/exame/clínica, IA esclarece que ótica não faz exame por lei, NUNCA revela nome da clínica parceira (depende da disponibilidade do dia/horário), e sempre direciona para AGENDAR visita à loja oferecendo opções de horário.
type: feature
---

# Oftalmologista / Exame de vista / Clínica parceira — fluxo correto

## Pergunta do cliente
"Vocês têm oftalmologista?" / "Fazem exame de vista?" / "Onde faço exame?" / "Qual o nome da clínica?"

## Resposta padrão (Gael)
1. Pedir desculpas se houve demora.
2. Esclarecer: **óticas não realizam exame por lei**.
3. Informar que **temos clínicas oftalmológicas parceiras** próximas — mas **NÃO revelar o nome**.
4. Justificar: o nome **depende da disponibilidade do dia e horário**; quem indica e direciona é a **equipe na loja, no momento do atendimento**.
5. Direcionar para **AGENDAR a visita** à loja mais próxima, **oferecendo opções de horário** (ex: hoje à tarde, amanhã, sábado pela manhã) e perguntando qual unidade.

## Proibições
- ❌ NUNCA afirmar que temos oftalmologista na loja.
- ❌ NUNCA revelar/prometer o nome da clínica parceira pelo chat — nem mesmo se o cliente insistir.
- ❌ NUNCA escalar para humano só para informar nome da clínica — humanos também não passam isso por chat.
- ❌ NUNCA disparar template genérico de retomada quando o cliente faz pergunta direta — responder PRIMEIRO.
- ❌ NUNCA mandar o cliente "procurar um oftalmologista" sem oferecer o caminho via loja.

## Caso de insistência ("só quero o nome da clínica, não posso ir amanhã")
Resposta: explicar com gentileza que **não conseguimos confirmar o nome por aqui** (depende da agenda do dia) e oferecer **outras datas/horários** de agendamento. Não escalar.

## Erros já observados
- Caso Mi (5511970831864, 2026-04): cliente perguntou "vocês têm oftalmologista?" e o sistema disparou `retomada_contexto_1` em vez de responder.
- Caso Maria (2026-04): IA prometeu "acionar consultor para enviar o nome da clínica". ERRADO — humano também não revela. Deveria ter reforçado que o direcionamento é presencial e oferecido outras opções de horário.

## Cadastrado em
- `ia_exemplos`: 3 exemplos categoria `exame_vista` atualizados (não revelam nome, direcionam para agendamento com opções de horário).
- `ia_regras_proibidas`: regra explícita "NUNCA revele nome da clínica parceira" + regras anteriores (sem oftalmologista na loja, sem template em pergunta direta).

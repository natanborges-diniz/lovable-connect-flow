## Plano

1. Blindar o fluxo quando já existir agendamento ativo
- Ajustar `supabase/functions/ai-triage/index.ts` para tratar `agendado`/`confirmado` como contexto prioritário.
- Se o cliente já tiver visita ativa e mandar algo genérico como “Agendar”, “manter”, “ok”, “confirmado” ou encerrar a conversa, a IA não poderá abrir novo fluxo de marcação.
- Só permitir novo fluxo quando houver intenção explícita de alteração, como remarcar, mudar horário, trocar loja ou cancelar.

2. Tornar a criação de agendamento idempotente
- Reforçar `supabase/functions/agendar-cliente/index.ts` para não inserir novo registro se o contato já tiver um agendamento ativo equivalente, retornando o existente.
- Endurecer também o guard em `ai-triage` para não chamar a criação novamente em cenários de reconfirmação.
- Objetivo: mesmo que a IA escorregue, a camada de persistência ainda impede duplicidade.

3. Corrigir o pós-agendamento e encerramento
- Ajustar o pós-agendamento em `ai-triage` para que, depois da confirmação, o assistente:
  - envie comparativo quando o cliente aceitar,
  - finalize quando o cliente disser “não”, “obg”, “encerro por aqui”,
  - não pergunte “mantemos ou cancela?” sem pedido explícito do cliente.
- Manter respostas determinísticas curtas nesse trecho para evitar loop e reabertura do agendamento.

4. Padronizar data/hora no fuso de São Paulo
- Corrigir a formatação em `ai-triage` e `agendar-cliente` para impedir discrepâncias como 17:00 virar 20:00 na mensagem enviada ao cliente.
- Aplicar a mesma regra no bloco “Agendamento confirmado” e no texto de fechamento com dados do agendamento.

## Resultado esperado
- Um cliente já agendado não gera novo agendamento ao repetir “Agendar”.
- Confirmações e agradecimentos apenas mantêm o agendamento existente e encerram corretamente.
- O comparativo continua funcionando sem reabrir a marcação.
- Loja, data e horário aparecem consistentes na resposta final.

## Detalhes técnicos
- Arquivos a ajustar:
  - `supabase/functions/ai-triage/index.ts`
  - `supabase/functions/agendar-cliente/index.ts`
- Não preciso alterar tabelas, RLS nem autenticação; a correção é de lógica e formatação sobre a estrutura atual de `agendamentos`.
- Vou preservar o comportamento atual de `reagendar_visita` para casos explícitos de remarcação e no-show.
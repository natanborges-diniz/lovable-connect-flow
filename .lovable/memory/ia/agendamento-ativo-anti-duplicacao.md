---
name: Agendamento ativo — anti-duplicação e proibições
description: Quando o cliente já tem agendamento ativo (agendado/lembrete_enviado/confirmado), Gael não pode chamar agendar_visita nem perguntar "manter ou cancelar" sem pedido explícito. Mensagens curtas tipo "Agendar", "Manter", "Sim", "Obg" são tratadas como confirmação do existente. Bloqueio em 3 camadas: hint pré-LLM, guardrail no executor da tool e idempotência em agendar-cliente.
type: feature
---

## Regra
Se há agendamento em status `agendado`/`lembrete_enviado`/`confirmado` para o contato e o cliente NÃO pediu explicitamente alteração (palavras: remarcar, reagendar, mudar/trocar horário/dia/data/loja, cancelar, antecipar, adiar, outro horário/dia, outra loja), Gael:

- Não chama `agendar_visita` nem `reagendar_visita`.
- Não pergunta "mantemos ou prefere cancelar?".
- Não oferece cancelamento.
- Trata "Agendar", "Manter", "Sim", "Ok", "Confirmado", "Obg" como confirmação do existente: "Tudo certo, te espero {agendamentoFmt} 👋" e segue comparativo/encerramento.

## Implementação (`supabase/functions/ai-triage/index.ts`)

1. **Hint pré-LLM** (antes do `callAI`): se `hasAgendamentoAtivo && !explicitChange`, injeta system message proibindo chamadas das tools de agendamento e perguntas de cancelamento.

2. **Loop-detector + intent agendar**: quando `forcedIntent.tool === "agendar_cliente_intent"` e há agendamento ativo, troca o prompt forçado por reafirmação do existente.

3. **Guardrail no executor de `agendar_visita`**: antes de criar o registro, se já existe ativo e o cliente não pediu mudança, retorna mensagem "Tudo certo, seu agendamento segue mantido — {agendamentoFmt}" sem `📍 Agendamento confirmado` (já foi enviado antes), grava `agendamento_duplicado_evitado`.

## Idempotência (`supabase/functions/agendar-cliente/index.ts`)
Antes do `INSERT`, busca agendamentos ativos do contato. Se houver um:
- com mesma loja e mesmo dia (YYYY-MM-DD), OU
- em janela de ±24h em torno da data alvo,

retorna o existente com `duplicate: true` e grava evento `agendamento_duplicado_evitado`.

## Fuso horário
Datas e horários sempre formatados em `America/Sao_Paulo` em ai-triage e agendar-cliente. Evita o bug 17:00 → 20:00 visto em produção.

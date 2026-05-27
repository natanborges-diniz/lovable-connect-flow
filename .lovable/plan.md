## Diagnóstico — atendimento da Iolanda

Linha do tempo do atendimento `27ece2a1` (contato `17a88957`, agendamento Qua 27/05 15:00 DINIZ CARAPICUIBA):

| Quando (UTC) | Evento | Origem |
|---|---|---|
| 26/05 01:54–01:59 | Triagem, receita confirmada, cotação, escolha de loja, agendamento Qua 15h | IA normal |
| 26/05 11:00:04 | "Bom dia, Iolanda… Posso confirmar?" | `agendamentos-cron` → **lembrete véspera (D-1)** |
| 26/05 11:00:09 | Template `retomada_contexto_1` + "Quer dar continuidade?" | `vendas-recuperacao-cron` → **tentativa 1/2** |
| 26/05 13:08 | Cliente responde "✅ Confirmo" → confirmação + aviso à loja | OK, recuperação cancelada |
| **27/05 11:15** | **Template `retomada_contexto_1` + "Quer dar continuidade?"** | **`vendas-recuperacao-cron` → tentativa 1/2 (de novo)** |

Os dois envios estranhos vêm do **cron de recuperação de vendas** disparando mesmo com o agendamento ativo:

1. **26/05 11:00** — O lembrete véspera e a retomada de vendas dispararam **no mesmo minuto** (não houve lock entre eles). Resultado: 3 balões em 5 segundos.
2. **27/05 11:15** — Cliente já tinha **confirmado a visita 22h antes** (status `confirmado`), e mesmo assim o cron iniciou nova cadência de retomada ("tentativa 1/2"). Foi esse o "ele retornou conversa" que você viu.

## Causa raiz

`supabase/functions/vendas-recuperacao-cron/index.ts` decide elegibilidade do atendimento sem checar a tabela `agendamentos`. A varredura por `grep` confirma: o arquivo não tem nenhuma referência a `agendamentos` / `hasAgendamentoAtivo` / status `confirmado`. Hoje só barra por encerramento explícito, despedida ou `cancelar_visita`. Cliente que confirmou e ficou em silêncio aguardando a visita continua "elegível" para retomada.

Bônus: também não há lock cruzado com `agendamentos-cron` (lembrete véspera / dia-D), por isso o pacote duplo de 26/05 11:00.

## Correções propostas

Escopo: edge function `vendas-recuperacao-cron` apenas. Sem mudanças de UI, schema ou prompts.

1. **Guardrail "agendamento ativo"** — antes de marcar atendimento como elegível à retomada, buscar `agendamentos` do contato com `status IN ('agendado','lembrete_enviado','confirmado')` e `data_horario > now() - 2h`. Se houver, pular e registrar `eventos_crm.tipo='recuperacao_suprimida_agendamento_ativo'`. Cobre os dois casos da Iolanda (D-1 já lembrado + D-day já confirmado).

2. **Lock anti-sobreposição com lembrete** — se o último outbound do atendimento foi um lembrete (`lembrete_vespera_enviado` ou `lembrete_dia_d_at`) há menos de 2h, adiar a retomada para o próximo ciclo (mesmo padrão já usado em `retomada_adiada_janela_noturna`).

3. **Idempotência adicional para `confirmado`** — após `agendamento_confirmado_cliente` recente (<48h), nunca disparar recuperação. Mesmo se a guarda (1) falhar por race condition, a (3) protege contra repetir o template no dia da visita.

4. **Pós-visita** — manter a fase atual de "pós-venda/follow-up" apenas para atendimentos cujo agendamento mais recente está com `data_horario < now() - 24h` E status terminal (`compareceu` / `venda_fechada` / `no_show`). Hoje a porta está aberta inadvertidamente para agendamentos no futuro.

## Verificação após o deploy

- Rodar `vendas-recuperacao-cron` manualmente com o contato da Iolanda e confirmar evento `recuperacao_suprimida_agendamento_ativo` nos logs.
- Conferir que `eventos_crm` para clientes recém-confirmados deixa de registrar `recuperacao_tentativa` enquanto o agendamento está no futuro.
- Spot-check em 3 outros atendimentos confirmados nas últimas 48h para garantir que nenhum recebeu nova retomada após o ajuste.

## Atualizações de memória

- `mem://crm/recuperacao-ia-anti-abandono` — registrar que cadência é suprimida quando há `agendamentos` ativo/confirmado.
- `mem://watchdog/lead-silencioso-perdidos` — anotar exceção: agendamento confirmado bloqueia tanto retomada quanto move-to-Perdidos.

## Fora de escopo

- Não vou alterar o lembrete véspera/dia-D em si, nem o template `retomada_contexto_1`.
- Sem mudanças no `ai-triage`, prompt do LLM ou schema.

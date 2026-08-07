# Correção: "Falar com atendente" não escalou (caso Kamila)

## O que aconteceu (verificado nos dados)

Atendimento `5dbfa721…` (Kamila), 06/08:

- 18:58:25 — IA enviou "Pode me contar sua dúvida por aqui 😊"
- 18:58:30 — cliente escreveu **"Falar com atendente"** (mensagem de texto normal, sem botão)
- Nenhuma resposta, nenhum evento de escalonamento. Só às 20:00 saiu o template de retomada.

Duas falhas somadas:

**1. Debounce engoliu a mensagem.** Em `ai-triage` existe um guard anti-duplicidade: se houve qualquer OUTBOUND nos últimos 10s, a execução retorna `skipped` **antes** de qualquer roteador. A mensagem chegou 5s após a resposta da IA, então nunca chegou ao router de escalada (que reconhece "falar com atendente" na lista de palavras-chave). Ou seja: cliente que responde rápido é ignorado.

**2. A rede de segurança está caída.** O cron de 1 em 1 minuto que chama `watchdog-inbound-orfao` (que re-dispara a IA quando o último evento é um inbound sem resposta) está retornando **401 "Unregistered API key"** em todas as execuções — o header ainda usa a chave antiga, invalidada na rotação de chaves. Último resgate registrado: 29/07. Os jobs `auto-arquivar-cards` e `regua-disparo-aguardando-armacao` usam a mesma chave antiga e estão no mesmo estado.

## Correções propostas

### A. Debounce não pode descartar mensagem do cliente
Em `supabase/functions/ai-triage/index.ts`, no guard "outbound <10s":
- Antes de retornar `skipped`, verificar se a mensagem atual é pedido explícito de humano (`matchesEscalation`) ou consulta de OS — nesses casos seguir o fluxo normalmente.
- Para as demais mensagens, em vez de descartar em silêncio, aguardar o restante da janela (~10s) e reprocessar, só abortando se outra execução já tiver respondido àquele inbound. Assim nenhuma mensagem de cliente fica sem tratamento.

### B. Router de escalada antes do debounce
Mover/duplicar o roteador de palavra-chave de escalada para antes dos guards de debounce/lock (como já existe para modo ponte/hibrido), garantindo que "falar com atendente" sempre entre na fila humana, em qualquer modo e em qualquer timing.

### C. Reativar o watchdog
Reescrever os agendamentos pg_cron que ainda usam a chave antiga (`watchdog-inbound-orfao`, `auto-arquivar-cards`, `regua-disparo-aguardando-armacao`) com a chave válida atual, via migration. Depois confirmar execução com resposta 200 e log da função.

### D. Verificação
- Simular: inbound com "falar com atendente" logo após um outbound → conferir `modo=humano`, evento `escalonamento_humano` e card na fila.
- Conferir `net._http_response` sem 401 nos jobs corrigidos e novo evento `orfao_pos_resposta_recuperado` quando houver órfão.

## Observação
O atendimento da Kamila já está em `modo=humano` desde 20:34 (escalada por insatisfação), então não precisa de correção manual — a ação aqui é evitar a recorrência.

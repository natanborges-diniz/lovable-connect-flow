## Objetivo
Impedir qualquer nova retomada automática quando a cliente:
- cancelar/desmarcar a visita e disser que vai remarcar depois
- pedir para encerrar o atendimento
- sinalizar que prefere deixar em aberto sem nova insistência

## Plano
1. Ajustar o `ai-triage` para persistir encerramento real nos fluxos terminais.
   - Quando houver `cancelar_visita` seguido de intenção clara de “deixar em aberto / remarcar depois”, responder de forma final e curta, sem oferecer nova retomada.
   - Quando houver `encerrar atendimento` explícito, além da despedida determinística, gravar um bloqueio persistente de retomada no atendimento/contato.
   - Garantir que despedidas após cancelamento nunca reutilizem `agendamentoFmt` nem frases como “Te espero ...”.

2. Blindar o cron `vendas-recuperacao-cron` contra retomadas indevidas.
   - Antes de enviar `retomada_contexto_1`, verificar sinais terminais recentes na conversa e nos metadados.
   - Pular retomada quando existir cancelamento confirmado, pedido explícito de encerramento, ou marcador de “não retomar / remarcar depois”.
   - Aplicar o mesmo bloqueio tanto para cadência IA quanto para cadência humano/híbrido, para não haver template após despedida final.

3. Cobrir o caso conversacional mostrado.
   - Se a cliente disser “volto para marcar depois”, “deixo em aberto”, “depois eu procuro”, o fluxo deve encerrar cordialmente e orientar apenas: “quando quiser remarcar é só chamar”.
   - Se depois disso ela disser “encerrar atendimento”, o sistema deve apenas confirmar o encerramento e manter a conversa fora da cadência automática.

4. Reforçar a proteção por redundância.
   - Manter o cancelamento persistido no agendamento (`status=cancelado`) como fonte principal.
   - Adicionar bloqueio defensivo por leitura de mensagens/eventos recentes, para cobrir qualquer caso legado em que o status não tenha sido salvo a tempo.

5. Validar com o cenário informado.
   - Simular a sequência: recusa da visita -> cancelamento -> “volto para marcar depois” -> “encerrar atendimento”.
   - Confirmar que não saem nem template de retomada, nem lembrete de visita, nem despedida com data cancelada.

## Detalhes técnicos
- Arquivos mais prováveis:
  - `supabase/functions/ai-triage/index.ts`
  - `supabase/functions/vendas-recuperacao-cron/index.ts`
- Ajustes esperados:
  - introduzir um marcador persistente como `nao_retornar_automaticamente` / `encerrado_pelo_cliente_at` / motivo equivalente em metadata
  - usar esse marcador no gate do cron antes de qualquer template
  - revisar os blocos de `isExplicitClose`, `isShortNoToHelp`, `isThanksClose` e o fluxo `cancelar_visita`
- Critério de aceite:
  - cliente que cancelou e disse que remarcará depois não recebe retomada automática
  - cliente que pediu encerramento não recebe nenhum template posterior
  - nenhuma despedida volta a mencionar horário já cancelado
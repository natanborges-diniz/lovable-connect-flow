-- Registra o job de reconciliação da régua em cron_jobs com ativo=false.
-- Roda às 07:30 SP (10:30 UTC), após a carga do Firebird (~07:00 SP).
-- Para ligar: UPDATE cron_jobs SET ativo = true WHERE nome = 'regua-reconciliacao-diaria'
-- e então acionar manage-cron-jobs {action:"create"} com a expressão correta.

INSERT INTO public.cron_jobs (nome, descricao, expressao_cron, funcao_alvo, payload, ativo)
SELECT
  'regua-reconciliacao-diaria',
  'Reconcilia inscrições aguardando entrega: valida OS via Firebird, seta âncora de entrega e ativa a régua.',
  '30 10 * * *',
  'regua-reconciliacao',
  '{}'::jsonb,
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.cron_jobs WHERE nome = 'regua-reconciliacao-diaria'
);

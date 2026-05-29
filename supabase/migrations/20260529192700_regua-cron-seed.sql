-- Registra o job de ingestão da régua em cron_jobs com ativo=false.
-- NÃO cria o pg_cron ainda — só o registro para visibilidade.
-- Para ligar: UPDATE cron_jobs SET ativo = true WHERE nome = 'regua-ingestao-diaria'
-- e então acionar manage-cron-jobs {action:"create"} com a expressão correta.

INSERT INTO public.cron_jobs (nome, descricao, expressao_cron, funcao_alvo, payload, ativo)
SELECT
  'regua-ingestao-diaria',
  'Importa entregas do dia anterior e aniversariantes do Firebird para a régua pós-venda. Roda às 06:00 SP (09:00 UTC).',
  '0 9 * * *',
  'regua-ingestao',
  '{"empresa": null, "dry_run": false}'::jsonb,
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.cron_jobs WHERE nome = 'regua-ingestao-diaria'
);

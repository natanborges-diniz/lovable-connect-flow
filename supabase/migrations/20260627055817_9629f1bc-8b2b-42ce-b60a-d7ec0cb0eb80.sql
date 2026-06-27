
INSERT INTO public.cron_jobs (nome, descricao, expressao_cron, funcao_alvo, payload, ativo)
SELECT
  'auto-arquivar-cards-diario',
  'Marca metadata.arquivado_at em solicitações paradas há N dias em colunas terminais. Não move card; oculta da UI por padrão.',
  '30 6 * * *',
  'auto-arquivar-cards',
  '{}'::jsonb,
  false
WHERE NOT EXISTS (SELECT 1 FROM public.cron_jobs WHERE nome = 'auto-arquivar-cards-diario');

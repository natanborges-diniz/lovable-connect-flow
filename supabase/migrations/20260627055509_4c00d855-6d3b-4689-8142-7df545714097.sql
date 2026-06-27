
-- Auto-arquivamento de colunas terminais do pipeline
ALTER TABLE public.pipeline_colunas
  ADD COLUMN IF NOT EXISTS terminal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dias_auto_arquivar integer NOT NULL DEFAULT 7;

-- Índice para varredura rápida do cron por metadata.arquivado_at
CREATE INDEX IF NOT EXISTS idx_solicitacoes_arquivado_at
  ON public.solicitacoes ((metadata->>'arquivado_at'));

-- Marca colunas terminais conhecidas do setor Financeiro
UPDATE public.pipeline_colunas
SET terminal = true
WHERE setor_id = (SELECT id FROM public.setores WHERE nome = 'Financeiro' LIMIT 1)
  AND nome IN (
    'Link Enviado','Link Pago','PIX Confirmado','PIX Não Confirmado',
    'Boleto Enviado','Consulta CPF Reprovada','Consulta CPF Aprovado',
    'Concluído','Cancelado','Dados Incompletos','Estorno Solicitado'
  );

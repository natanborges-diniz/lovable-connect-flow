
-- Demandas internas (loja → setor) sem cliente final vinculado
ALTER TABLE public.demandas_loja
  ALTER COLUMN atendimento_cliente_id DROP NOT NULL,
  ALTER COLUMN contato_cliente_id DROP NOT NULL;

ALTER TABLE public.demandas_loja
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'cliente',
  ADD COLUMN IF NOT EXISTS tipo_chave text,
  ADD COLUMN IF NOT EXISTS assunto text,
  ADD COLUMN IF NOT EXISTS setor_destino_id uuid;

CREATE INDEX IF NOT EXISTS idx_demandas_loja_origem ON public.demandas_loja(origem);
CREATE INDEX IF NOT EXISTS idx_demandas_loja_setor_destino ON public.demandas_loja(setor_destino_id);
CREATE INDEX IF NOT EXISTS idx_demandas_loja_solicitante ON public.demandas_loja(solicitante_id);

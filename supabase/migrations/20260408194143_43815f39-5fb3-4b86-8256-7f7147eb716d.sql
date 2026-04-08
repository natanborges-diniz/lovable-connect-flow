
ALTER TABLE public.telefones_lojas
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'loja',
  ADD COLUMN IF NOT EXISTS cargo text,
  ADD COLUMN IF NOT EXISTS nome_colaborador text;

COMMENT ON COLUMN public.telefones_lojas.tipo IS 'loja, colaborador ou departamento';
COMMENT ON COLUMN public.telefones_lojas.cargo IS 'Cargo do colaborador (ex: Gerente, Vendedor)';
COMMENT ON COLUMN public.telefones_lojas.nome_colaborador IS 'Nome da pessoa física (colaboradores)';

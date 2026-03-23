
-- Tabela de colunas dinâmicas do pipeline
CREATE TABLE public.pipeline_colunas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cor text NOT NULL DEFAULT 'muted-foreground',
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_colunas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage pipeline_colunas"
  ON public.pipeline_colunas FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Adicionar referência em contatos
ALTER TABLE public.contatos ADD COLUMN pipeline_coluna_id uuid REFERENCES public.pipeline_colunas(id) ON DELETE SET NULL;

-- Seed colunas padrão
INSERT INTO public.pipeline_colunas (nome, cor, ordem) VALUES
  ('Lead', 'muted-foreground', 0),
  ('Qualificado', 'info', 1),
  ('Proposta', 'warning', 2),
  ('Fechado', 'success', 3);

-- Migrar dados existentes: mapear estagio enum para pipeline_coluna_id
UPDATE public.contatos SET pipeline_coluna_id = (SELECT id FROM public.pipeline_colunas WHERE nome = 'Lead') WHERE estagio = 'lead';
UPDATE public.contatos SET pipeline_coluna_id = (SELECT id FROM public.pipeline_colunas WHERE nome = 'Qualificado') WHERE estagio = 'qualificado';
UPDATE public.contatos SET pipeline_coluna_id = (SELECT id FROM public.pipeline_colunas WHERE nome = 'Proposta') WHERE estagio = 'proposta';
UPDATE public.contatos SET pipeline_coluna_id = (SELECT id FROM public.pipeline_colunas WHERE nome = 'Fechado') WHERE estagio = 'fechado';

-- Trigger updated_at
CREATE TRIGGER update_pipeline_colunas_updated_at
  BEFORE UPDATE ON public.pipeline_colunas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

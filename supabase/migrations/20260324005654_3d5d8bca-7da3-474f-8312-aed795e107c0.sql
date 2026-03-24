CREATE TABLE public.conhecimento_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria text NOT NULL DEFAULT 'produtos',
  titulo text NOT NULL,
  conteudo jsonb NOT NULL DEFAULT '{}',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conhecimento_ia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage conhecimento_ia"
  ON public.conhecimento_ia FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_conhecimento_ia_updated_at
  BEFORE UPDATE ON public.conhecimento_ia
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
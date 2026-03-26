
CREATE TABLE public.ia_regras_proibidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regra text NOT NULL,
  categoria text NOT NULL DEFAULT 'informacao_falsa',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.ia_regras_proibidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage ia_regras_proibidas"
  ON public.ia_regras_proibidas
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

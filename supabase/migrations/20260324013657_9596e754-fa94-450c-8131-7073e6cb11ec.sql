
CREATE TABLE public.telefones_lojas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone text NOT NULL UNIQUE,
  nome_loja text NOT NULL,
  cod_empresa text,
  departamento text DEFAULT 'geral',
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.telefones_lojas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage telefones_lojas"
  ON public.telefones_lojas FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TABLE public.bot_sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id uuid NOT NULL,
  fluxo text NOT NULL DEFAULT 'menu_principal',
  etapa text NOT NULL DEFAULT 'inicio',
  dados jsonb DEFAULT '{}',
  status text DEFAULT 'ativo',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.bot_sessoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage bot_sessoes"
  ON public.bot_sessoes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_bot_sessoes_updated_at
  BEFORE UPDATE ON public.bot_sessoes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

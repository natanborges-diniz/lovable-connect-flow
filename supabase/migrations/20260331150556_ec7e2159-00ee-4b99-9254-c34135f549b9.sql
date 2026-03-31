-- Create bot_menu_opcoes table for configurable bot menu
CREATE TABLE public.bot_menu_opcoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE,
  titulo text NOT NULL,
  emoji text NOT NULL DEFAULT '▶️',
  descricao text,
  fluxo text NOT NULL,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bot_menu_opcoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage bot_menu_opcoes"
  ON public.bot_menu_opcoes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access bot_menu_opcoes"
  ON public.bot_menu_opcoes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Anon can read bot_menu_opcoes"
  ON public.bot_menu_opcoes FOR SELECT TO anon
  USING (true);

CREATE TRIGGER update_bot_menu_opcoes_updated_at
  BEFORE UPDATE ON public.bot_menu_opcoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.bot_menu_opcoes (chave, titulo, emoji, fluxo, ordem) VALUES
  ('link_pagamento', 'Gerar Link de Pagamento', '1️⃣', 'link_pagamento', 1),
  ('gerar_boleto', 'Gerar Boleto', '2️⃣', 'gerar_boleto', 2),
  ('consulta_cpf', 'Consultar CPF', '3️⃣', 'consulta_cpf', 3),
  ('confirmar_comparecimento', 'Confirmar Comparecimento de Cliente', '4️⃣', 'confirmar_comparecimento', 4);
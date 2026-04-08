
-- 1. Create fluxo_responsaveis table
CREATE TABLE public.fluxo_responsaveis (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fluxo_chave text NOT NULL,
  nome text NOT NULL,
  telefone text NOT NULL,
  tipo text NOT NULL DEFAULT 'primario',
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.fluxo_responsaveis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage fluxo_responsaveis"
  ON public.fluxo_responsaveis FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access fluxo_responsaveis"
  ON public.fluxo_responsaveis FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Anon can read fluxo_responsaveis"
  ON public.fluxo_responsaveis FOR SELECT TO anon
  USING (true);

CREATE TRIGGER update_fluxo_responsaveis_updated_at
  BEFORE UPDATE ON public.fluxo_responsaveis
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Create TI setor
INSERT INTO public.setores (id, nome, descricao)
VALUES ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'TI', 'Tecnologia da Informação');

-- 3. New pipeline columns for Financeiro (setor 7cd0d465...)
INSERT INTO public.pipeline_colunas (nome, setor_id, ordem, cor) VALUES
  ('Estorno Solicitado', '7cd0d465-bb9d-4097-a1ae-93106fb82d48', 12, 'destructive'),
  ('Devolução OS',       '7cd0d465-bb9d-4097-a1ae-93106fb82d48', 13, 'muted-foreground'),
  ('Reembolso',          '7cd0d465-bb9d-4097-a1ae-93106fb82d48', 14, 'muted-foreground'),
  ('Pagamentos',         '7cd0d465-bb9d-4097-a1ae-93106fb82d48', 15, 'muted-foreground'),
  ('Autorização Dataweb','7cd0d465-bb9d-4097-a1ae-93106fb82d48', 16, 'muted-foreground'),
  ('Compra Funcionário', '7cd0d465-bb9d-4097-a1ae-93106fb82d48', 17, 'muted-foreground');

-- 4. Pipeline columns for TI
INSERT INTO public.pipeline_colunas (nome, setor_id, ordem, cor) VALUES
  ('Novo',             'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 0, 'muted-foreground'),
  ('Impressões',       'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 1, 'muted-foreground'),
  ('Suporte Técnico',  'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 2, 'muted-foreground'),
  ('Concluído',        'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 3, 'primary');

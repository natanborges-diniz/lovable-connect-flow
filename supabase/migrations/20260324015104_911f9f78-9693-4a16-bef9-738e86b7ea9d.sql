
-- Add setor_id to pipeline_colunas (NULL = pipeline de vendas, FK = pipeline do setor)
ALTER TABLE public.pipeline_colunas ADD COLUMN setor_id uuid REFERENCES public.setores(id) ON DELETE SET NULL;

-- Add pipeline_coluna_id to solicitacoes for sector pipelines
ALTER TABLE public.solicitacoes ADD COLUMN pipeline_coluna_id uuid REFERENCES public.pipeline_colunas(id) ON DELETE SET NULL;

-- Create Financeiro setor
INSERT INTO public.setores (nome, descricao) VALUES ('Financeiro', 'Setor responsável por links de pagamento, boletos, consultas CPF e operações financeiras');

-- Insert pipeline columns for Financeiro
-- We need the setor id, so use a DO block
DO $$
DECLARE
  v_setor_id uuid;
BEGIN
  SELECT id INTO v_setor_id FROM public.setores WHERE nome = 'Financeiro' LIMIT 1;
  
  INSERT INTO public.pipeline_colunas (nome, ordem, setor_id, cor) VALUES
    ('Novo', 0, v_setor_id, 'muted-foreground'),
    ('Link Enviado', 1, v_setor_id, 'primary'),
    ('Aguardando Pagamento', 2, v_setor_id, 'warning'),
    ('Pago', 3, v_setor_id, 'success'),
    ('Cancelado', 4, v_setor_id, 'destructive'),
    ('Consulta CPF', 5, v_setor_id, 'info'),
    ('Solicitação de Boleto', 6, v_setor_id, 'muted-foreground'),
    ('Boleto Enviado', 7, v_setor_id, 'primary'),
    ('Consulta CPF Reprovada', 8, v_setor_id, 'destructive'),
    ('Consulta CPF Aprovado', 9, v_setor_id, 'success'),
    ('Confirmação PIX', 10, v_setor_id, 'info');
END $$;


-- Tabela de feedbacks humanos sobre respostas da IA
CREATE TABLE public.ia_feedbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mensagem_id uuid NOT NULL,
  atendimento_id uuid NOT NULL,
  avaliacao text NOT NULL,
  resposta_corrigida text,
  motivo text,
  avaliador_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ia_feedbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage ia_feedbacks"
  ON public.ia_feedbacks FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Tabela de exemplos modelo para few-shot learning
CREATE TABLE public.ia_exemplos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria text NOT NULL DEFAULT 'geral',
  pergunta text NOT NULL,
  resposta_ideal text NOT NULL,
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ia_exemplos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage ia_exemplos"
  ON public.ia_exemplos FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

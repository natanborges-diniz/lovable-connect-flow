
-- 1) cashback_config
CREATE TABLE public.cashback_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  percentual numeric NOT NULL DEFAULT 15,
  validade_dias int NOT NULL DEFAULT 90,
  prorrogacao_dias int NOT NULL DEFAULT 30,
  fator_resgate numeric NOT NULL DEFAULT 3,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashback_config TO authenticated;
GRANT ALL ON public.cashback_config TO service_role;
ALTER TABLE public.cashback_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage cashback_config"
  ON public.cashback_config FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access cashback_config"
  ON public.cashback_config FOR ALL TO service_role
  USING (true) WITH CHECK (true);

INSERT INTO public.cashback_config DEFAULT VALUES;

-- 2) cashback_credito
CREATE TABLE public.cashback_credito (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid REFERENCES public.contatos(id),
  inscricao_id uuid REFERENCES public.regua_inscricao(id),
  valor_base numeric,
  valor_gerado numeric,
  saldo numeric,
  data_geracao date,
  data_expiracao date,
  prorrogado boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ativo',
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashback_credito TO authenticated;
GRANT ALL ON public.cashback_credito TO service_role;
ALTER TABLE public.cashback_credito ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage cashback_credito"
  ON public.cashback_credito FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access cashback_credito"
  ON public.cashback_credito FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX idx_cashback_credito_contato ON public.cashback_credito(contato_id);
CREATE INDEX idx_cashback_credito_status ON public.cashback_credito(status);
CREATE INDEX idx_cashback_credito_expiracao ON public.cashback_credito(data_expiracao);

-- 3) cashback_resgate
CREATE TABLE public.cashback_resgate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid REFERENCES public.contatos(id),
  credito_id uuid REFERENCES public.cashback_credito(id),
  valor_usado numeric,
  numero_venda_uso text,
  data_uso timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashback_resgate TO authenticated;
GRANT ALL ON public.cashback_resgate TO service_role;
ALTER TABLE public.cashback_resgate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage cashback_resgate"
  ON public.cashback_resgate FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access cashback_resgate"
  ON public.cashback_resgate FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE INDEX idx_cashback_resgate_contato ON public.cashback_resgate(contato_id);
CREATE INDEX idx_cashback_resgate_credito ON public.cashback_resgate(credito_id);

ALTER TABLE public.contatos ADD COLUMN IF NOT EXISTS data_nascimento date;

DROP TABLE IF EXISTS public.regua_touchpoint CASCADE;
DROP TABLE IF EXISTS public.regua_os CASCADE;
DROP TABLE IF EXISTS public.regua_inscricao CASCADE;

CREATE TABLE public.regua_inscricao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid REFERENCES public.contatos(id) ON DELETE SET NULL,
  cpf text,
  nome_cliente text,
  whatsapp text,
  numero_venda text NOT NULL UNIQUE,
  valor_total_informado numeric,
  valor_total_validado numeric,
  valor_status text NOT NULL DEFAULT 'pendente',
  origem text,
  cod_empresa text,
  usuario_lancamento text,
  consentimento_status text NOT NULL DEFAULT 'pendente',
  consentimento_at timestamptz,
  canal_consentimento text,
  status text NOT NULL DEFAULT 'aguardando_entrega',
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.regua_inscricao TO authenticated;
GRANT ALL ON public.regua_inscricao TO service_role;

ALTER TABLE public.regua_inscricao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage regua_inscricao"
  ON public.regua_inscricao FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access regua_inscricao"
  ON public.regua_inscricao FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_regua_inscricao_contato ON public.regua_inscricao(contato_id);
CREATE INDEX idx_regua_inscricao_cpf ON public.regua_inscricao(cpf);
CREATE INDEX idx_regua_inscricao_status ON public.regua_inscricao(status);

CREATE TABLE public.regua_os (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inscricao_id uuid NOT NULL REFERENCES public.regua_inscricao(id) ON DELETE CASCADE,
  os_numero text NOT NULL,
  classificacao text NOT NULL DEFAULT 'desconhecida',
  data_entrega date,
  reconciliado_at timestamptz,
  UNIQUE (inscricao_id, os_numero)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.regua_os TO authenticated;
GRANT ALL ON public.regua_os TO service_role;

ALTER TABLE public.regua_os ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage regua_os"
  ON public.regua_os FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access regua_os"
  ON public.regua_os FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_regua_os_inscricao ON public.regua_os(inscricao_id);

CREATE TABLE public.regua_touchpoint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inscricao_id uuid NOT NULL REFERENCES public.regua_inscricao(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  data_prevista date NOT NULL,
  status text NOT NULL DEFAULT 'PENDENTE',
  template_key text,
  canal text,
  enviado_at timestamptz,
  status_entrega text,
  UNIQUE (inscricao_id, tipo)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.regua_touchpoint TO authenticated;
GRANT ALL ON public.regua_touchpoint TO service_role;

ALTER TABLE public.regua_touchpoint ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage regua_touchpoint"
  ON public.regua_touchpoint FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access regua_touchpoint"
  ON public.regua_touchpoint FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_regua_touchpoint_inscricao ON public.regua_touchpoint(inscricao_id);
CREATE INDEX idx_regua_touchpoint_status_data ON public.regua_touchpoint(status, data_prevista);
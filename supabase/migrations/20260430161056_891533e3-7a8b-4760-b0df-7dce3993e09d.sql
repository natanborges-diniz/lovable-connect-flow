-- 1. Ampliar enum app_role com 'supervisao' e 'diretoria' (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'supervisao' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'supervisao';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'diretoria' AND enumtypid = 'public.app_role'::regtype) THEN
    ALTER TYPE public.app_role ADD VALUE 'diretoria';
  END IF;
END $$;

-- 2. Catálogo de processos que aceitam autorização de exceção
CREATE TABLE IF NOT EXISTS public.processos_excecao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE,
  nome text NOT NULL,
  descricao text,
  niveis_autorizadores text[] NOT NULL DEFAULT ARRAY['supervisao','diretoria']::text[],
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.processos_excecao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read processos_excecao"
  ON public.processos_excecao FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage processos_excecao"
  ON public.processos_excecao FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Service role full access processos_excecao"
  ON public.processos_excecao FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.processos_excecao (chave, nome, descricao, niveis_autorizadores)
VALUES ('consulta_cpf_excecao', 'Consulta CPF — exceção', 'Pedido de autorização para liberar consulta de CPF reprovada ou com dados incompletos.', ARRAY['supervisao','diretoria'])
ON CONFLICT (chave) DO NOTHING;

-- 3. Tabela de autorizações
CREATE TABLE IF NOT EXISTS public.autorizacoes_excecao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_chave text NOT NULL,
  referencia_tipo text NOT NULL,
  referencia_id uuid NOT NULL,
  solicitante_id uuid NOT NULL,
  solicitante_nome text,
  autorizador_id uuid NOT NULL,
  autorizador_nome text,
  autorizador_role text,
  contexto jsonb NOT NULL DEFAULT '{}'::jsonb,
  motivo_solicitacao text,
  status text NOT NULL DEFAULT 'pendente',
  justificativa_resposta text,
  respondido_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_autorizacoes_excecao_ref ON public.autorizacoes_excecao(referencia_tipo, referencia_id);
CREATE INDEX IF NOT EXISTS idx_autorizacoes_excecao_autorizador ON public.autorizacoes_excecao(autorizador_id, status);
CREATE INDEX IF NOT EXISTS idx_autorizacoes_excecao_status ON public.autorizacoes_excecao(status);

ALTER TABLE public.autorizacoes_excecao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view autorizacoes_excecao"
  ON public.autorizacoes_excecao FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert autorizacoes_excecao"
  ON public.autorizacoes_excecao FOR INSERT TO authenticated
  WITH CHECK (solicitante_id = auth.uid());

CREATE POLICY "Authorizer or admin can update autorizacoes_excecao"
  ON public.autorizacoes_excecao FOR UPDATE TO authenticated
  USING (autorizador_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (autorizador_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Service role full access autorizacoes_excecao"
  ON public.autorizacoes_excecao FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_autorizacoes_excecao_updated
  BEFORE UPDATE ON public.autorizacoes_excecao
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_processos_excecao_updated
  BEFORE UPDATE ON public.processos_excecao
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
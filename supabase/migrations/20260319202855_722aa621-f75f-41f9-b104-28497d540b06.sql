
-- ==========================
-- ENUMS
-- ==========================
CREATE TYPE public.tipo_contato AS ENUM ('cliente', 'fornecedor', 'loja', 'colaborador');
CREATE TYPE public.tipo_canal AS ENUM ('whatsapp', 'sistema', 'email', 'telefone');
CREATE TYPE public.status_solicitacao AS ENUM ('aberta', 'classificada', 'em_atendimento', 'aguardando_execucao', 'concluida', 'cancelada', 'reaberta');
CREATE TYPE public.prioridade AS ENUM ('critica', 'alta', 'normal', 'baixa');

-- ==========================
-- CONTATOS (Core CRM)
-- ==========================
CREATE TABLE public.contatos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  tipo tipo_contato NOT NULL DEFAULT 'cliente',
  documento TEXT,
  email TEXT,
  telefone TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  tags TEXT[] DEFAULT '{}',
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.contatos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view contacts"
  ON public.contatos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert contacts"
  ON public.contatos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update contacts"
  ON public.contatos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete contacts"
  ON public.contatos FOR DELETE TO authenticated USING (true);

-- ==========================
-- CANAIS
-- ==========================
CREATE TABLE public.canais (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contato_id UUID NOT NULL REFERENCES public.contatos(id) ON DELETE CASCADE,
  tipo tipo_canal NOT NULL,
  identificador TEXT NOT NULL,
  principal BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.canais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage canais"
  ON public.canais FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_canais_contato ON public.canais(contato_id);
CREATE INDEX idx_canais_identificador ON public.canais(identificador);

-- ==========================
-- EVENTOS CRM
-- ==========================
CREATE TABLE public.eventos_crm (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contato_id UUID NOT NULL REFERENCES public.contatos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  descricao TEXT,
  referencia_tipo TEXT,
  referencia_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.eventos_crm ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage eventos"
  ON public.eventos_crm FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_eventos_contato ON public.eventos_crm(contato_id);

-- ==========================
-- SOLICITAÇÕES
-- ==========================
CREATE TABLE public.solicitacoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contato_id UUID NOT NULL REFERENCES public.contatos(id) ON DELETE RESTRICT,
  canal_origem tipo_canal NOT NULL DEFAULT 'sistema',
  status status_solicitacao NOT NULL DEFAULT 'aberta',
  assunto TEXT NOT NULL,
  descricao TEXT,
  tipo TEXT,
  prioridade prioridade NOT NULL DEFAULT 'normal',
  classificacao_ia JSONB,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.solicitacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view solicitacoes"
  ON public.solicitacoes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert solicitacoes"
  ON public.solicitacoes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update solicitacoes"
  ON public.solicitacoes FOR UPDATE TO authenticated USING (true);

CREATE INDEX idx_solicitacoes_contato ON public.solicitacoes(contato_id);
CREATE INDEX idx_solicitacoes_status ON public.solicitacoes(status);

-- ==========================
-- TIMESTAMP TRIGGER
-- ==========================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_contatos_updated_at
  BEFORE UPDATE ON public.contatos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_solicitacoes_updated_at
  BEFORE UPDATE ON public.solicitacoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

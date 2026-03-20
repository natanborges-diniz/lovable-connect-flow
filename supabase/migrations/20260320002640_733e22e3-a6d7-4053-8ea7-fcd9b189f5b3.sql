
-- ==============================
-- PHASE 2: Setores, Filas, Atendimentos, Mensagens, Tarefas
-- ==============================

-- Enums
CREATE TYPE public.tipo_fila AS ENUM ('atendimento', 'execucao');
CREATE TYPE public.status_atendimento AS ENUM ('aguardando', 'em_atendimento', 'encerrado');
CREATE TYPE public.direcao_mensagem AS ENUM ('inbound', 'outbound', 'internal');
CREATE TYPE public.status_tarefa AS ENUM ('pendente', 'em_andamento', 'concluida', 'cancelada');

-- Setores
CREATE TABLE public.setores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.setores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage setores" ON public.setores FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_setores_updated_at BEFORE UPDATE ON public.setores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Filas
CREATE TABLE public.filas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setor_id UUID NOT NULL REFERENCES public.setores(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  tipo tipo_fila NOT NULL,
  descricao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  sla_minutos INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.filas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage filas" ON public.filas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_filas_updated_at BEFORE UPDATE ON public.filas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Atendimentos
CREATE TABLE public.atendimentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  solicitacao_id UUID NOT NULL REFERENCES public.solicitacoes(id) ON DELETE CASCADE,
  fila_id UUID REFERENCES public.filas(id),
  contato_id UUID NOT NULL REFERENCES public.contatos(id),
  status status_atendimento NOT NULL DEFAULT 'aguardando',
  canal tipo_canal NOT NULL DEFAULT 'sistema',
  atendente_nome TEXT,
  inicio_at TIMESTAMPTZ,
  fim_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.atendimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage atendimentos" ON public.atendimentos FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_atendimentos_updated_at BEFORE UPDATE ON public.atendimentos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Mensagens
CREATE TABLE public.mensagens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  atendimento_id UUID NOT NULL REFERENCES public.atendimentos(id) ON DELETE CASCADE,
  direcao direcao_mensagem NOT NULL DEFAULT 'inbound',
  conteudo TEXT NOT NULL,
  remetente_nome TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mensagens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage mensagens" ON public.mensagens FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Enable realtime for mensagens
ALTER PUBLICATION supabase_realtime ADD TABLE public.mensagens;

-- Tarefas
CREATE TABLE public.tarefas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  solicitacao_id UUID REFERENCES public.solicitacoes(id) ON DELETE SET NULL,
  fila_id UUID REFERENCES public.filas(id),
  titulo TEXT NOT NULL,
  descricao TEXT,
  status status_tarefa NOT NULL DEFAULT 'pendente',
  prioridade prioridade NOT NULL DEFAULT 'normal',
  responsavel_nome TEXT,
  prazo_at TIMESTAMPTZ,
  concluida_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tarefas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage tarefas" ON public.tarefas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER update_tarefas_updated_at BEFORE UPDATE ON public.tarefas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Checklist Items
CREATE TABLE public.checklist_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tarefa_id UUID NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  concluido BOOLEAN NOT NULL DEFAULT false,
  ordem INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage checklist_items" ON public.checklist_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

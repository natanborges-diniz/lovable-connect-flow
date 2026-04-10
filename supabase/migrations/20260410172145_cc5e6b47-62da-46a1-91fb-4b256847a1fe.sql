
-- 1. Tabela de notificações in-app
CREATE TABLE public.notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  setor_id uuid REFERENCES public.setores(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  mensagem text,
  tipo text NOT NULL DEFAULT 'solicitacao',
  referencia_id uuid,
  lida boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

-- Users see their own notifications or notifications for their sector
CREATE POLICY "Users can view own notifications"
  ON public.notificacoes FOR SELECT TO authenticated
  USING (usuario_id = auth.uid() OR setor_id IN (
    SELECT setor_id FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update own notifications"
  ON public.notificacoes FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid() OR setor_id IN (
    SELECT setor_id FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Service role full access notificacoes"
  ON public.notificacoes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can insert notificacoes"
  ON public.notificacoes FOR INSERT TO authenticated
  WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes;

-- 2. Tabela de comentários nas solicitações
CREATE TABLE public.solicitacao_comentarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public.solicitacoes(id) ON DELETE CASCADE,
  autor_id uuid REFERENCES public.profiles(id),
  autor_nome text,
  conteudo text NOT NULL,
  tipo text NOT NULL DEFAULT 'interno',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.solicitacao_comentarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage solicitacao_comentarios"
  ON public.solicitacao_comentarios FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access solicitacao_comentarios"
  ON public.solicitacao_comentarios FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3. Coluna setor_destino_id em bot_fluxos
ALTER TABLE public.bot_fluxos
  ADD COLUMN setor_destino_id uuid REFERENCES public.setores(id);

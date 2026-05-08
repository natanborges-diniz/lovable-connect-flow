
-- Tabela de metadados de conversas em grupo
CREATE TABLE public.conversas_grupo (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  participantes uuid[] NOT NULL DEFAULT '{}',
  criado_por uuid NOT NULL,
  avatar_url text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversas_grupo_participantes ON public.conversas_grupo USING GIN (participantes);

ALTER TABLE public.conversas_grupo ENABLE ROW LEVEL SECURITY;

-- Trigger updated_at
CREATE TRIGGER trg_conversas_grupo_updated_at
BEFORE UPDATE ON public.conversas_grupo
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper SECURITY DEFINER: confere se um user é membro de um grupo (evita recursão de RLS)
CREATE OR REPLACE FUNCTION public.is_group_member(_grupo_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversas_grupo
    WHERE id = _grupo_id AND _user_id = ANY(participantes)
  );
$$;

-- Helper para extrair UUID do conversa_id 'grupo_<uuid>'
CREATE OR REPLACE FUNCTION public.grupo_id_from_conversa(_conversa_id text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _conversa_id LIKE 'grupo_%' THEN substring(_conversa_id from 7)::uuid
    ELSE NULL
  END;
$$;

-- RLS conversas_grupo
CREATE POLICY "Members can view group"
ON public.conversas_grupo FOR SELECT TO authenticated
USING (auth.uid() = ANY(participantes) OR is_admin(auth.uid()));

CREATE POLICY "Only admin can create group"
ON public.conversas_grupo FOR INSERT TO authenticated
WITH CHECK (is_admin(auth.uid()) AND criado_por = auth.uid());

CREATE POLICY "Admin or creator can update group"
ON public.conversas_grupo FOR UPDATE TO authenticated
USING (is_admin(auth.uid()) OR criado_por = auth.uid())
WITH CHECK (is_admin(auth.uid()) OR criado_por = auth.uid());

CREATE POLICY "Admin can delete group"
ON public.conversas_grupo FOR DELETE TO authenticated
USING (is_admin(auth.uid()));

CREATE POLICY "Service role full access conversas_grupo"
ON public.conversas_grupo FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Atualizar política INSERT em mensagens_internas para aceitar grupo
DROP POLICY IF EXISTS "Users can send 1to1 or system messages" ON public.mensagens_internas;

CREATE POLICY "Users can send 1to1 group or system messages"
ON public.mensagens_internas FOR INSERT TO authenticated
WITH CHECK (
  remetente_id = auth.uid() AND (
    conversa_id LIKE 'demanda_%'
    OR conversa_id LIKE 'ponte_%'
    OR (
      conversa_id LIKE 'grupo_%'
      AND is_group_member(grupo_id_from_conversa(conversa_id), auth.uid())
      AND is_group_member(grupo_id_from_conversa(conversa_id), destinatario_id)
    )
    OR pode_conversar_1a1(auth.uid(), destinatario_id)
  )
);


-- 1) Função única de "quem pode gerenciar usuários"
CREATE OR REPLACE FUNCTION public.pode_gerenciar_usuarios(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- admin clássico
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'admin')
    OR
    -- modelo novo: acesso total OU permissão para agir em Configurações
    EXISTS (
      SELECT 1 FROM public.user_acessos
      WHERE user_id = _uid
        AND (
          acesso_total = true
          OR modulos->>'configuracoes' IN ('agir','encerrar')
        )
    );
$$;

-- 2) user_acessos: troca policy de admin -> gestor
DROP POLICY IF EXISTS "Admins manage user_acessos" ON public.user_acessos;
CREATE POLICY "Gestores manage user_acessos"
ON public.user_acessos FOR ALL TO authenticated
USING (public.pode_gerenciar_usuarios(auth.uid()))
WITH CHECK (public.pode_gerenciar_usuarios(auth.uid()));

-- 3) profiles: UPDATE por gestor (mantém outras policies)
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Gestores podem editar profiles"
ON public.profiles FOR UPDATE TO authenticated
USING (public.pode_gerenciar_usuarios(auth.uid()) OR id = auth.uid())
WITH CHECK (public.pode_gerenciar_usuarios(auth.uid()) OR id = auth.uid());

-- 4) user_roles: INSERT/UPDATE/DELETE por gestor
DROP POLICY IF EXISTS "Admins can insert user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete user_roles" ON public.user_roles;

CREATE POLICY "Gestores podem inserir user_roles"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (public.pode_gerenciar_usuarios(auth.uid()));

CREATE POLICY "Gestores podem atualizar user_roles"
ON public.user_roles FOR UPDATE TO authenticated
USING (public.pode_gerenciar_usuarios(auth.uid()))
WITH CHECK (public.pode_gerenciar_usuarios(auth.uid()));

CREATE POLICY "Gestores podem remover user_roles"
ON public.user_roles FOR DELETE TO authenticated
USING (public.pode_gerenciar_usuarios(auth.uid()));

-- 5) Remove gatilho legado em profiles que duplica trabalho do sync_from_user_acessos
DROP TRIGGER IF EXISTS sync_user_roles_from_profile_trg ON public.profiles;
DROP TRIGGER IF EXISTS trg_sync_user_roles_from_profile ON public.profiles;
DROP TRIGGER IF EXISTS sync_user_roles_from_profile ON public.profiles;

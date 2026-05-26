
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND tipo_usuario IS NOT DISTINCT FROM (SELECT p.tipo_usuario FROM public.profiles p WHERE p.id = auth.uid())
    AND setor_id   IS NOT DISTINCT FROM (SELECT p.setor_id   FROM public.profiles p WHERE p.id = auth.uid())
    AND lojas      IS NOT DISTINCT FROM (SELECT p.lojas      FROM public.profiles p WHERE p.id = auth.uid())
    AND ativo      IS NOT DISTINCT FROM (SELECT p.ativo      FROM public.profiles p WHERE p.id = auth.uid())
  );

DROP POLICY IF EXISTS "Authenticated users can read cpf docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete cpf docs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload cpf docs" ON storage.objects;

CREATE POLICY "Users read own cpf docs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'cpf-documentos'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin(auth.uid()))
  );

CREATE POLICY "Users upload own cpf docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cpf-documentos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users delete own cpf docs"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'cpf-documentos'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin(auth.uid()))
  );

DROP POLICY IF EXISTS "Anon can read bot_fluxos" ON public.bot_fluxos;
DROP POLICY IF EXISTS "Anon can read bot_menu_opcoes" ON public.bot_menu_opcoes;
REVOKE SELECT ON public.bot_fluxos FROM anon;
REVOKE SELECT ON public.bot_menu_opcoes FROM anon;

DROP POLICY IF EXISTS "Authenticated read ia_auditorias" ON public.ia_auditorias;
CREATE POLICY "Admins read ia_auditorias"
  ON public.ia_auditorias FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

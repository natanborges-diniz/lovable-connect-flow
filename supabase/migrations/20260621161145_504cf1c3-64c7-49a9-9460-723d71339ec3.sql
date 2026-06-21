DROP POLICY IF EXISTS "Users upload own cpf docs" ON storage.objects;
DROP POLICY IF EXISTS "Users read own cpf docs"   ON storage.objects;
DROP POLICY IF EXISTS "Users update own cpf docs" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own cpf docs" ON storage.objects;

CREATE POLICY "Financeiro upload cpf docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cpf-documentos');

CREATE POLICY "Financeiro read cpf docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cpf-documentos');

CREATE POLICY "Financeiro update cpf docs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'cpf-documentos')
  WITH CHECK (bucket_id = 'cpf-documentos');

CREATE POLICY "Admin delete cpf docs" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'cpf-documentos' AND public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Anexos: upload do próprio usuário" ON storage.objects;
DROP POLICY IF EXISTS "Anexos: update do próprio usuário" ON storage.objects;
DROP POLICY IF EXISTS "Anexos: delete do próprio usuário" ON storage.objects;

CREATE POLICY "Anexos: upload autenticado" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'mensagens-anexos');

CREATE POLICY "Anexos: update autenticado" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'mensagens-anexos')
  WITH CHECK (bucket_id = 'mensagens-anexos');

CREATE POLICY "Anexos: delete autenticado" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'mensagens-anexos');
-- Fix 1: Restrict cpf-documentos bucket to financeiro/admin role
DROP POLICY IF EXISTS "Financeiro read cpf docs" ON storage.objects;
DROP POLICY IF EXISTS "Financeiro upload cpf docs" ON storage.objects;
DROP POLICY IF EXISTS "Financeiro update cpf docs" ON storage.objects;

CREATE POLICY "Financeiro read cpf docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cpf-documentos'
    AND (
      is_admin(auth.uid())
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'operador'::app_role)
      OR has_role(auth.uid(), 'supervisao'::app_role)
      OR has_role(auth.uid(), 'diretoria'::app_role)
    )
  );

CREATE POLICY "Financeiro upload cpf docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cpf-documentos'
    AND (
      is_admin(auth.uid())
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'operador'::app_role)
      OR has_role(auth.uid(), 'supervisao'::app_role)
      OR has_role(auth.uid(), 'diretoria'::app_role)
    )
  );

CREATE POLICY "Financeiro update cpf docs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cpf-documentos'
    AND (
      is_admin(auth.uid())
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'operador'::app_role)
      OR has_role(auth.uid(), 'supervisao'::app_role)
      OR has_role(auth.uid(), 'diretoria'::app_role)
    )
  )
  WITH CHECK (
    bucket_id = 'cpf-documentos'
    AND (
      is_admin(auth.uid())
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'operador'::app_role)
      OR has_role(auth.uid(), 'supervisao'::app_role)
      OR has_role(auth.uid(), 'diretoria'::app_role)
    )
  );

-- Fix 2: Add explicit staff-only INSERT/UPDATE/DELETE on regua_inscricao
CREATE POLICY "Staff insert regua_inscricao" ON public.regua_inscricao
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'operador'::app_role)
    OR has_role(auth.uid(), 'supervisao'::app_role)
    OR has_role(auth.uid(), 'diretoria'::app_role)
  );

CREATE POLICY "Staff update regua_inscricao" ON public.regua_inscricao
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'operador'::app_role)
    OR has_role(auth.uid(), 'supervisao'::app_role)
    OR has_role(auth.uid(), 'diretoria'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'operador'::app_role)
    OR has_role(auth.uid(), 'supervisao'::app_role)
    OR has_role(auth.uid(), 'diretoria'::app_role)
  );

CREATE POLICY "Staff delete regua_inscricao" ON public.regua_inscricao
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretoria'::app_role)
  );
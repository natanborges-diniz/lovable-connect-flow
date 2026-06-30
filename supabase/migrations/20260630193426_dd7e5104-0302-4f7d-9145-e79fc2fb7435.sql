-- Permitir membros do setor Financeiro (setor_usuario com setor_id = Financeiro) a operar no bucket cpf-documentos.
DROP POLICY IF EXISTS "Financeiro upload cpf docs" ON storage.objects;
DROP POLICY IF EXISTS "Financeiro read cpf docs" ON storage.objects;
DROP POLICY IF EXISTS "Financeiro update cpf docs" ON storage.objects;

CREATE POLICY "Financeiro upload cpf docs" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'cpf-documentos'
  AND (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operador'::app_role)
    OR public.has_role(auth.uid(), 'supervisao'::app_role)
    OR public.has_role(auth.uid(), 'diretoria'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.setores s ON s.id = ur.setor_id
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'setor_usuario'
        AND s.nome ILIKE 'Financeiro'
    )
  )
);

CREATE POLICY "Financeiro read cpf docs" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'cpf-documentos'
  AND (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operador'::app_role)
    OR public.has_role(auth.uid(), 'supervisao'::app_role)
    OR public.has_role(auth.uid(), 'diretoria'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.setores s ON s.id = ur.setor_id
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'setor_usuario'
        AND s.nome ILIKE 'Financeiro'
    )
  )
);

CREATE POLICY "Financeiro update cpf docs" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'cpf-documentos'
  AND (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operador'::app_role)
    OR public.has_role(auth.uid(), 'supervisao'::app_role)
    OR public.has_role(auth.uid(), 'diretoria'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.setores s ON s.id = ur.setor_id
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'setor_usuario'
        AND s.nome ILIKE 'Financeiro'
    )
  )
)
WITH CHECK (
  bucket_id = 'cpf-documentos'
  AND (
    public.is_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operador'::app_role)
    OR public.has_role(auth.uid(), 'supervisao'::app_role)
    OR public.has_role(auth.uid(), 'diretoria'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.setores s ON s.id = ur.setor_id
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'setor_usuario'
        AND s.nome ILIKE 'Financeiro'
    )
  )
);
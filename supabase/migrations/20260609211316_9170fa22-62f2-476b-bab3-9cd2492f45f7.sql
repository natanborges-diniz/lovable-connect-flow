
-- pricing_table_lentes
DROP POLICY IF EXISTS "Authenticated can manage pricing_table_lentes" ON public.pricing_table_lentes;
CREATE POLICY "Admins manage pricing_table_lentes" ON public.pricing_table_lentes
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- pricing_lentes_contato
DROP POLICY IF EXISTS "Authenticated can manage pricing_lentes_contato" ON public.pricing_lentes_contato;
CREATE POLICY "Admins manage pricing_lentes_contato" ON public.pricing_lentes_contato
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- feriados
DROP POLICY IF EXISTS "Authenticated manage feriados" ON public.feriados;
CREATE POLICY "Authenticated read feriados" ON public.feriados
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage feriados" ON public.feriados
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- loja_feriado_politica
DROP POLICY IF EXISTS "Authenticated manage loja_feriado_politica" ON public.loja_feriado_politica;
CREATE POLICY "Authenticated read loja_feriado_politica" ON public.loja_feriado_politica
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage loja_feriado_politica" ON public.loja_feriado_politica
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ia_exemplos
DROP POLICY IF EXISTS "Authenticated users can manage ia_exemplos" ON public.ia_exemplos;
CREATE POLICY "Authenticated read ia_exemplos" ON public.ia_exemplos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage ia_exemplos" ON public.ia_exemplos
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- pipeline_automacoes
DROP POLICY IF EXISTS "Authenticated users can manage pipeline_automacoes" ON public.pipeline_automacoes;
CREATE POLICY "Authenticated read pipeline_automacoes" ON public.pipeline_automacoes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage pipeline_automacoes" ON public.pipeline_automacoes
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- pagamentos_link_eventos: alinhar leitura com pagamentos_link (staff only)
DROP POLICY IF EXISTS "Authenticated read pagamentos_link_eventos" ON public.pagamentos_link_eventos;
CREATE POLICY "Staff read pagamentos_link_eventos" ON public.pagamentos_link_eventos
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'operador'::app_role)
    OR has_role(auth.uid(), 'supervisao'::app_role)
    OR has_role(auth.uid(), 'diretoria'::app_role)
  );

-- Storage: cpf-documentos UPDATE policy (owner-scoped)
CREATE POLICY "Users update own cpf docs"
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cpf-documentos'
    AND (((storage.foldername(name))[1] = (auth.uid())::text) OR is_admin(auth.uid()))
  )
  WITH CHECK (
    bucket_id = 'cpf-documentos'
    AND (((storage.foldername(name))[1] = (auth.uid())::text) OR is_admin(auth.uid()))
  );

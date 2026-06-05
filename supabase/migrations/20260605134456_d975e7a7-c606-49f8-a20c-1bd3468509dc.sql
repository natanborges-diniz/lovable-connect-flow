
-- ============ Lock down config tables to admin writes ============
-- bot_fluxos
DROP POLICY IF EXISTS "Authenticated users can manage bot_fluxos" ON public.bot_fluxos;
CREATE POLICY "Authenticated read bot_fluxos" ON public.bot_fluxos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write bot_fluxos" ON public.bot_fluxos FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- bot_menu_opcoes
DROP POLICY IF EXISTS "Authenticated users can manage bot_menu_opcoes" ON public.bot_menu_opcoes;
CREATE POLICY "Authenticated read bot_menu_opcoes" ON public.bot_menu_opcoes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write bot_menu_opcoes" ON public.bot_menu_opcoes FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- cashback_config
DROP POLICY IF EXISTS "Authenticated users can manage cashback_config" ON public.cashback_config;
CREATE POLICY "Authenticated read cashback_config" ON public.cashback_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write cashback_config" ON public.cashback_config FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- conhecimento_ia
DROP POLICY IF EXISTS "Authenticated users can manage conhecimento_ia" ON public.conhecimento_ia;
CREATE POLICY "Authenticated read conhecimento_ia" ON public.conhecimento_ia FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write conhecimento_ia" ON public.conhecimento_ia FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ia_instrucoes_prompt
DROP POLICY IF EXISTS "Authenticated manage ia_instrucoes_prompt" ON public.ia_instrucoes_prompt;
CREATE POLICY "Authenticated read ia_instrucoes_prompt" ON public.ia_instrucoes_prompt FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write ia_instrucoes_prompt" ON public.ia_instrucoes_prompt FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- pipeline_colunas
DROP POLICY IF EXISTS "Authenticated users can manage pipeline_colunas" ON public.pipeline_colunas;
CREATE POLICY "Authenticated read pipeline_colunas" ON public.pipeline_colunas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write pipeline_colunas" ON public.pipeline_colunas FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- telefones_lojas
DROP POLICY IF EXISTS "Authenticated users can manage telefones_lojas" ON public.telefones_lojas;
CREATE POLICY "Authenticated read telefones_lojas" ON public.telefones_lojas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin write telefones_lojas" ON public.telefones_lojas FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============ Cashback financial tables: admin/operador read, service_role only writes ============
DROP POLICY IF EXISTS "Authenticated users can manage cashback_credito" ON public.cashback_credito;
CREATE POLICY "Staff read cashback_credito" ON public.cashback_credito FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'supervisao') OR public.has_role(auth.uid(),'diretoria'));

DROP POLICY IF EXISTS "Authenticated users can manage cashback_resgate" ON public.cashback_resgate;
CREATE POLICY "Staff read cashback_resgate" ON public.cashback_resgate FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'supervisao') OR public.has_role(auth.uid(),'diretoria'));

-- ============ pagamentos_link: staff only ============
DROP POLICY IF EXISTS "Authenticated manage pagamentos_link" ON public.pagamentos_link;
CREATE POLICY "Staff read pagamentos_link" ON public.pagamentos_link FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'supervisao') OR public.has_role(auth.uid(),'diretoria'));
CREATE POLICY "Staff write pagamentos_link" ON public.pagamentos_link FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador'));
CREATE POLICY "Staff update pagamentos_link" ON public.pagamentos_link FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador'));
CREATE POLICY "Admin delete pagamentos_link" ON public.pagamentos_link FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- ============ contatos: restrict DELETE to admin ============
DROP POLICY IF EXISTS "Authenticated users can delete contacts" ON public.contatos;
CREATE POLICY "Admin can delete contacts" ON public.contatos FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- ============ regua_inscricao (CPF/PII): staff read; service_role writes ============
DROP POLICY IF EXISTS "Authenticated users can manage regua_inscricao" ON public.regua_inscricao;
CREATE POLICY "Staff read regua_inscricao" ON public.regua_inscricao FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operador') OR public.has_role(auth.uid(),'supervisao') OR public.has_role(auth.uid(),'diretoria'));

-- ============ Fix function search_path ============
ALTER FUNCTION public.touch_user_acessos() SET search_path = public;

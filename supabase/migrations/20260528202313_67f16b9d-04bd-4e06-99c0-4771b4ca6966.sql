
-- configuracoes_ia: admin-only writes, authenticated read
DROP POLICY IF EXISTS "Authenticated users can manage configuracoes_ia" ON public.configuracoes_ia;
CREATE POLICY "Authenticated read configuracoes_ia" ON public.configuracoes_ia
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage configuracoes_ia" ON public.configuracoes_ia
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- fluxo_responsaveis: admin-only writes, authenticated read
DROP POLICY IF EXISTS "Authenticated users can manage fluxo_responsaveis" ON public.fluxo_responsaveis;
CREATE POLICY "Authenticated read fluxo_responsaveis" ON public.fluxo_responsaveis
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage fluxo_responsaveis" ON public.fluxo_responsaveis
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ia_regras_proibidas: admin-only writes, authenticated read
DROP POLICY IF EXISTS "Authenticated users can manage ia_regras_proibidas" ON public.ia_regras_proibidas;
CREATE POLICY "Authenticated read ia_regras_proibidas" ON public.ia_regras_proibidas
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage ia_regras_proibidas" ON public.ia_regras_proibidas
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- setores: admin-only writes, authenticated read
DROP POLICY IF EXISTS "Authenticated users can manage setores" ON public.setores;
CREATE POLICY "Authenticated read setores" ON public.setores
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage setores" ON public.setores
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ia_auditorias_acoes / grupos / runs: admin-only reads
DROP POLICY IF EXISTS "Authenticated read ia_auditorias_acoes" ON public.ia_auditorias_acoes;
CREATE POLICY "Admins read ia_auditorias_acoes" ON public.ia_auditorias_acoes
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated read ia_auditorias_grupos" ON public.ia_auditorias_grupos;
CREATE POLICY "Admins read ia_auditorias_grupos" ON public.ia_auditorias_grupos
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated read ia_auditorias_runs" ON public.ia_auditorias_runs;
CREATE POLICY "Admins read ia_auditorias_runs" ON public.ia_auditorias_runs
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

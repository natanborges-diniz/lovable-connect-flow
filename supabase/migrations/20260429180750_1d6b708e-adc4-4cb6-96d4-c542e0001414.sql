-- 1) Add descontinuado flag
ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS descontinuado boolean NOT NULL DEFAULT false;

-- 2) Aliases table
CREATE TABLE IF NOT EXISTS public.template_aliases (
  alias text PRIMARY KEY,
  template_nome text NOT NULL,
  descricao text,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.template_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view template_aliases"
  ON public.template_aliases FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage template_aliases"
  ON public.template_aliases FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Service role full access template_aliases"
  ON public.template_aliases FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3) Resolver function
CREATE OR REPLACE FUNCTION public.get_template_by_alias(_alias text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT template_nome FROM public.template_aliases WHERE alias = _alias LIMIT 1;
$$;
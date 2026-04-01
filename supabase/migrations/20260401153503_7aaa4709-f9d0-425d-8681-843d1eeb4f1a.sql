
-- Create pricing_table_lentes
CREATE TABLE public.pricing_table_lentes (
  id bigserial PRIMARY KEY,
  brand text NOT NULL,
  family text NOT NULL,
  category text NOT NULL,
  index_name text NOT NULL,
  treatment text NOT NULL,
  blue boolean DEFAULT false,
  photo boolean DEFAULT false,
  sphere_min numeric,
  sphere_max numeric,
  cylinder_min numeric,
  cylinder_max numeric,
  add_min numeric,
  add_max numeric,
  diameter numeric,
  min_fitting_height numeric,
  price_brl numeric NOT NULL,
  priority integer DEFAULT 10,
  active boolean DEFAULT true,
  source_catalog text,
  source_page text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- RLS
ALTER TABLE public.pricing_table_lentes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can read pricing_table_lentes" ON public.pricing_table_lentes FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can read pricing_table_lentes" ON public.pricing_table_lentes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can manage pricing_table_lentes" ON public.pricing_table_lentes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access pricing_table_lentes" ON public.pricing_table_lentes FOR ALL TO service_role USING (true) WITH CHECK (true);

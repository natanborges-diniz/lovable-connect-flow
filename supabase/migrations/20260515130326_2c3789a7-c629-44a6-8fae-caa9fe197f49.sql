
-- 1. Dedup duplicatas existentes (mantém a linha de maior id)
DELETE FROM public.pricing_table_lentes a
USING public.pricing_table_lentes b
WHERE a.ctid < b.ctid
  AND a.brand IS NOT DISTINCT FROM b.brand
  AND a.family IS NOT DISTINCT FROM b.family
  AND a.category IS NOT DISTINCT FROM b.category
  AND a.index_name IS NOT DISTINCT FROM b.index_name
  AND a.treatment IS NOT DISTINCT FROM b.treatment
  AND a.blue IS NOT DISTINCT FROM b.blue
  AND a.photo IS NOT DISTINCT FROM b.photo;

-- 2. Normaliza HOYA -> Hoya
UPDATE public.pricing_table_lentes SET brand = 'Hoya' WHERE brand = 'HOYA';

-- 3. Re-deduplica após normalização (HOYA + Hoya podiam coexistir)
DELETE FROM public.pricing_table_lentes a
USING public.pricing_table_lentes b
WHERE a.ctid < b.ctid
  AND a.brand IS NOT DISTINCT FROM b.brand
  AND a.family IS NOT DISTINCT FROM b.family
  AND a.category IS NOT DISTINCT FROM b.category
  AND a.index_name IS NOT DISTINCT FROM b.index_name
  AND a.treatment IS NOT DISTINCT FROM b.treatment
  AND a.blue IS NOT DISTINCT FROM b.blue
  AND a.photo IS NOT DISTINCT FROM b.photo;

-- 4. Dedup lentes de contato
DELETE FROM public.pricing_lentes_contato a
USING public.pricing_lentes_contato b
WHERE a.ctid < b.ctid
  AND a.fornecedor IS NOT DISTINCT FROM b.fornecedor
  AND a.produto IS NOT DISTINCT FROM b.produto
  AND a.descarte IS NOT DISTINCT FROM b.descarte;

-- 5. Constraints de unicidade
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pricing_table_lentes_unique_sku') THEN
    ALTER TABLE public.pricing_table_lentes
      ADD CONSTRAINT pricing_table_lentes_unique_sku
      UNIQUE (brand, family, category, index_name, treatment, blue, photo);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pricing_lentes_contato_unique_sku') THEN
    ALTER TABLE public.pricing_lentes_contato
      ADD CONSTRAINT pricing_lentes_contato_unique_sku
      UNIQUE (fornecedor, produto, descarte);
  END IF;
END $$;

-- 6. Índices
CREATE INDEX IF NOT EXISTS idx_ptl_filter   ON public.pricing_table_lentes (active, category, sphere_min, sphere_max);
CREATE INDEX IF NOT EXISTS idx_ptl_cylinder ON public.pricing_table_lentes (cylinder_min, cylinder_max);
CREATE INDEX IF NOT EXISTS idx_ptl_brand    ON public.pricing_table_lentes (brand);
CREATE INDEX IF NOT EXISTS idx_ptl_price    ON public.pricing_table_lentes (price_brl);

CREATE OR REPLACE FUNCTION public.apply_pricing_seed(rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.pricing_table_lentes (
    brand, family, category, index_name, treatment,
    blue, photo, sphere_min, sphere_max,
    cylinder_min, cylinder_max, add_min, add_max,
    diameter, min_fitting_height, price_brl,
    priority, active, source_catalog, source_page
  )
  SELECT
    (r->>'brand')::text,
    (r->>'family')::text,
    (r->>'category')::text,
    (r->>'index_name')::text,
    (r->>'treatment')::text,
    (r->>'blue')::boolean,
    (r->>'photo')::boolean,
    (r->>'sphere_min')::numeric,
    (r->>'sphere_max')::numeric,
    (r->>'cylinder_min')::numeric,
    (r->>'cylinder_max')::numeric,
    (r->>'add_min')::numeric,
    (r->>'add_max')::numeric,
    (r->>'diameter')::numeric,
    (r->>'min_fitting_height')::numeric,
    (r->>'price_brl')::numeric,
    COALESCE((r->>'priority')::integer, 10),
    COALESCE((r->>'active')::boolean, true),
    (r->>'source_catalog')::text,
    (r->>'source_page')::text
  FROM jsonb_array_elements(rows) AS r
  ON CONFLICT (brand, family, category, index_name, treatment, blue, photo)
  DO UPDATE SET
    sphere_min         = EXCLUDED.sphere_min,
    sphere_max         = EXCLUDED.sphere_max,
    cylinder_min       = EXCLUDED.cylinder_min,
    cylinder_max       = EXCLUDED.cylinder_max,
    add_min            = EXCLUDED.add_min,
    add_max            = EXCLUDED.add_max,
    diameter           = EXCLUDED.diameter,
    min_fitting_height = EXCLUDED.min_fitting_height,
    price_brl          = EXCLUDED.price_brl,
    priority           = EXCLUDED.priority,
    active             = EXCLUDED.active,
    source_catalog     = EXCLUDED.source_catalog,
    updated_at         = now();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_pricing_seed(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_pricing_seed(jsonb) TO service_role;

-- Normaliza HOYA → Hoya (via SECURITY DEFINER também)
CREATE OR REPLACE FUNCTION public.normalize_pricing_brand_hoya()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.pricing_table_lentes SET brand = 'Hoya' WHERE brand = 'HOYA';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.normalize_pricing_brand_hoya() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_pricing_brand_hoya() TO service_role;
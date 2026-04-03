
-- DMAX 1.56 variants (Filtro Azul, Foto, Foto Filtro Azul)
UPDATE pricing_table_lentes SET sphere_min = -8, sphere_max = 6, cylinder_min = -4, cylinder_max = 0, add_min = 0.75, add_max = 3.50
WHERE brand = 'DMAX' AND index_name LIKE '1.56%' AND category IN ('progressive', 'occupational') AND sphere_min IS NULL;

-- DNZ 1.50 UV+
UPDATE pricing_table_lentes SET sphere_min = -6, sphere_max = 6, cylinder_min = -4, cylinder_max = 0, add_min = 0.75, add_max = 3.50
WHERE brand = 'DNZ' AND index_name LIKE '1.50%' AND category IN ('progressive', 'occupational') AND sphere_min IS NULL;

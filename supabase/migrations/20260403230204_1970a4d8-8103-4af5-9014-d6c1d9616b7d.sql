
-- Fill technical limits for DNZ lenses
-- 1.50 progressive
UPDATE pricing_table_lentes SET sphere_min = -6, sphere_max = 6, cylinder_min = -4, cylinder_max = 0, add_min = 0.75, add_max = 3.50
WHERE brand = 'DNZ' AND index_name = '1.50' AND category IN ('progressive', 'occupational') AND sphere_min IS NULL;

-- 1.50 single_vision
UPDATE pricing_table_lentes SET sphere_min = -6, sphere_max = 6, cylinder_min = -4, cylinder_max = 0
WHERE brand = 'DNZ' AND index_name = '1.50' AND category = 'single_vision' AND sphere_min IS NULL;

-- 1.67 progressive
UPDATE pricing_table_lentes SET sphere_min = -13, sphere_max = 7.5, cylinder_min = -4, cylinder_max = 0, add_min = 0.75, add_max = 3.50
WHERE brand = 'DNZ' AND index_name = '1.67' AND category IN ('progressive', 'occupational') AND sphere_min IS NULL;

-- 1.67 single_vision
UPDATE pricing_table_lentes SET sphere_min = -13, sphere_max = 7.5, cylinder_min = -4, cylinder_max = 0
WHERE brand = 'DNZ' AND index_name = '1.67' AND category = 'single_vision' AND sphere_min IS NULL;

-- 1.74 progressive
UPDATE pricing_table_lentes SET sphere_min = -16, sphere_max = 8, cylinder_min = -4, cylinder_max = 0, add_min = 0.75, add_max = 3.50
WHERE brand = 'DNZ' AND index_name = '1.74' AND category IN ('progressive', 'occupational') AND sphere_min IS NULL;

-- 1.74 single_vision
UPDATE pricing_table_lentes SET sphere_min = -16, sphere_max = 8, cylinder_min = -4, cylinder_max = 0
WHERE brand = 'DNZ' AND index_name = '1.74' AND category = 'single_vision' AND sphere_min IS NULL;

-- Fill technical limits for DMAX lenses
-- 1.56 progressive/occupational
UPDATE pricing_table_lentes SET sphere_min = -8, sphere_max = 6, cylinder_min = -4, cylinder_max = 0, add_min = 0.75, add_max = 3.50
WHERE brand = 'DMAX' AND index_name = '1.56' AND category IN ('progressive', 'occupational') AND sphere_min IS NULL;

-- 1.56 single_vision
UPDATE pricing_table_lentes SET sphere_min = -8, sphere_max = 6, cylinder_min = -4, cylinder_max = 0
WHERE brand = 'DMAX' AND index_name = '1.56' AND category = 'single_vision' AND sphere_min IS NULL;

-- 1.59 progressive/occupational
UPDATE pricing_table_lentes SET sphere_min = -10, sphere_max = 6, cylinder_min = -4, cylinder_max = 0, add_min = 0.75, add_max = 3.50
WHERE brand = 'DMAX' AND index_name = '1.59' AND category IN ('progressive', 'occupational') AND sphere_min IS NULL;

-- 1.59 single_vision
UPDATE pricing_table_lentes SET sphere_min = -10, sphere_max = 6, cylinder_min = -4, cylinder_max = 0
WHERE brand = 'DMAX' AND index_name = '1.59' AND category = 'single_vision' AND sphere_min IS NULL;

-- 1.61 progressive/occupational
UPDATE pricing_table_lentes SET sphere_min = -10, sphere_max = 6, cylinder_min = -4, cylinder_max = 0, add_min = 0.75, add_max = 3.50
WHERE brand = 'DMAX' AND index_name = '1.61' AND category IN ('progressive', 'occupational') AND sphere_min IS NULL;

-- 1.61 single_vision
UPDATE pricing_table_lentes SET sphere_min = -10, sphere_max = 6, cylinder_min = -4, cylinder_max = 0
WHERE brand = 'DMAX' AND index_name = '1.61' AND category = 'single_vision' AND sphere_min IS NULL;

-- 1.67 progressive/occupational
UPDATE pricing_table_lentes SET sphere_min = -13, sphere_max = 7.5, cylinder_min = -4, cylinder_max = 0, add_min = 0.75, add_max = 3.50
WHERE brand = 'DMAX' AND index_name = '1.67' AND category IN ('progressive', 'occupational') AND sphere_min IS NULL;

-- 1.67 single_vision
UPDATE pricing_table_lentes SET sphere_min = -13, sphere_max = 7.5, cylinder_min = -4, cylinder_max = 0
WHERE brand = 'DMAX' AND index_name = '1.67' AND category = 'single_vision' AND sphere_min IS NULL;

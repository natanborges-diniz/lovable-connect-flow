UPDATE public.pricing_table_lentes SET index_name = CASE index_name
  WHEN 'S156' THEN 'Stylis 1.56'
  WHEN 'S167' THEN 'Stylis 1.67'
  WHEN 'S174' THEN 'Stylis 1.74'
  WHEN 'Orma' THEN 'Orma 1.50'
  WHEN 'Airwear' THEN 'Airwear 1.59'
  WHEN 'Poli' THEN 'Policarbonato 1.59'
  ELSE index_name END
WHERE brand = 'Essilor'
  AND index_name IN ('S156','S167','S174','Orma','Airwear','Poli');
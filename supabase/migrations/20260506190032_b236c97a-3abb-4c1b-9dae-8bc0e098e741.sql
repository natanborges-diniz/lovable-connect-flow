-- Remover linhas Hoya antigas (preservando Hoyalux D+) — etapa 1 do reset Hoya Abr/2025
-- A inserção de 429 linhas Hoya novas (h2) já foi feita via insert tool antes.
-- Este DELETE precisa rodar via migration por questão de permissão, e em seguida
-- rodaremos novamente o h1 para inserir as ~430 linhas restantes.
DELETE FROM public.pricing_table_lentes
WHERE brand = 'Hoya'
  AND family <> 'Hoyalux D+'
  AND id NOT IN (
    -- preservar as 429 linhas que acabaram de ser inseridas via h2
    SELECT id FROM public.pricing_table_lentes
    WHERE brand = 'Hoya' AND family <> 'Hoyalux D+'
    ORDER BY created_at DESC
    LIMIT 429
  );
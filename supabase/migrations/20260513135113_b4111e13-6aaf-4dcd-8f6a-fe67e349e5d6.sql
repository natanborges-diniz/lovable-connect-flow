-- Função para inferir bandeira do cartão a partir do BIN (mesmo algoritmo do payment-webhook)
CREATE OR REPLACE FUNCTION public.infer_brand_from_bin(bin_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  digits text;
  bin6 int;
  bin4 int;
  bin2 int;
  bin1 int;
BEGIN
  IF bin_raw IS NULL THEN RETURN NULL; END IF;
  digits := regexp_replace(bin_raw, '\D', '', 'g');
  IF length(digits) < 4 THEN RETURN NULL; END IF;
  bin6 := CASE WHEN length(digits) >= 6 THEN substring(digits,1,6)::int ELSE NULL END;
  bin4 := substring(digits,1,4)::int;
  bin2 := substring(digits,1,2)::int;
  bin1 := substring(digits,1,1)::int;

  -- Elo
  IF bin6 IS NOT NULL AND (
    (bin6 BETWEEN 401178 AND 401179) OR bin6 = 438935 OR bin6 = 451416 OR bin6 = 457393
    OR (bin6 BETWEEN 457631 AND 457632) OR bin6 = 504175
    OR (bin6 BETWEEN 506699 AND 506778) OR (bin6 BETWEEN 509000 AND 509999)
    OR bin6 = 627780 OR bin6 = 636297 OR bin6 = 636368
    OR (bin6 BETWEEN 650031 AND 650033) OR (bin6 BETWEEN 650035 AND 650051)
    OR (bin6 BETWEEN 650405 AND 650439) OR (bin6 BETWEEN 650485 AND 650538)
    OR (bin6 BETWEEN 650541 AND 650598) OR (bin6 BETWEEN 650700 AND 650718)
    OR (bin6 BETWEEN 650720 AND 650727) OR (bin6 BETWEEN 650901 AND 650920)
    OR (bin6 BETWEEN 651652 AND 651679) OR (bin6 BETWEEN 655000 AND 655019)
    OR (bin6 BETWEEN 655021 AND 655058)
  ) THEN RETURN 'Elo'; END IF;

  -- Hipercard
  IF bin6 IS NOT NULL AND (bin6 = 606282 OR bin6 = 637095 OR (bin6 BETWEEN 637568 AND 637599)) THEN
    RETURN 'Hipercard';
  END IF;

  IF bin2 BETWEEN 51 AND 55 THEN RETURN 'Mastercard'; END IF;
  IF bin4 BETWEEN 2221 AND 2720 THEN RETURN 'Mastercard'; END IF;
  IF bin1 = 4 THEN RETURN 'Visa'; END IF;
  IF bin2 IN (34, 37) THEN RETURN 'Amex'; END IF;
  IF bin2 IN (36, 38) THEN RETURN 'Diners'; END IF;
  IF bin4 BETWEEN 3000 AND 3059 THEN RETURN 'Diners'; END IF;
  IF bin4 = 6011 OR bin2 = 65 THEN RETURN 'Discover'; END IF;
  IF bin2 = 35 THEN RETURN 'JCB'; END IF;
  IF bin4 IN (5067, 4576, 4011) THEN RETURN 'Aura'; END IF;
  RETURN NULL;
END;
$$;

-- Backfill: aplica bandeira derivada onde temos BIN mas brand está nulo
UPDATE public.pagamentos_link
SET metadata = metadata
  || jsonb_build_object(
       'brand', public.infer_brand_from_bin(metadata->>'card_bin'),
       'brand_origem', 'derivado_bin'
     )
WHERE (metadata->>'brand') IS NULL
  AND (metadata->>'card_bin') IS NOT NULL
  AND public.infer_brand_from_bin(metadata->>'card_bin') IS NOT NULL;

-- Espelha em solicitacoes (mesma fonte de metadata)
UPDATE public.solicitacoes
SET metadata = metadata
  || jsonb_build_object(
       'brand', public.infer_brand_from_bin(metadata->>'card_bin'),
       'brand_origem', 'derivado_bin'
     )
WHERE tipo = 'link_pagamento'
  AND (metadata->>'brand') IS NULL
  AND (metadata->>'card_bin') IS NOT NULL
  AND public.infer_brand_from_bin(metadata->>'card_bin') IS NOT NULL;
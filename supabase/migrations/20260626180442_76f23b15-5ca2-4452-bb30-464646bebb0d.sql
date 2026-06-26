
-- Normaliza telefone BR para formato canônico 55DDD9XXXXXXXX (13 dígitos)
-- Devolve null se não der pra interpretar como celular BR válido.
CREATE OR REPLACE FUNCTION public.normalize_phone_br(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  digits text;
BEGIN
  IF raw IS NULL THEN RETURN NULL; END IF;
  digits := regexp_replace(raw, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN NULL; END IF;

  -- remove DDI 55 do início, se houver
  IF length(digits) >= 12 AND left(digits, 2) = '55' THEN
    digits := substring(digits from 3);
  END IF;

  -- agora deve ter 10 (fixo) ou 11 (celular com 9) dígitos
  IF length(digits) = 10 THEN
    -- inserir 9º dígito (assumir celular)
    digits := substring(digits from 1 for 2) || '9' || substring(digits from 3);
  END IF;

  IF length(digits) <> 11 THEN
    RETURN NULL; -- inválido
  END IF;

  RETURN '55' || digits;
END;
$$;

-- Busca contato tolerando formato de telefone diferente entre bridge e cadastro.
CREATE OR REPLACE FUNCTION public.match_contato_por_telefone(raw text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  alvo text;
  resultado uuid;
BEGIN
  alvo := public.normalize_phone_br(raw);
  IF alvo IS NULL THEN RETURN NULL; END IF;

  -- match exato OU normalizado dos dois lados
  SELECT id INTO resultado
  FROM public.contatos
  WHERE telefone = alvo
     OR public.normalize_phone_br(telefone) = alvo
  ORDER BY created_at ASC
  LIMIT 1;

  RETURN resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_phone_br(text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.match_contato_por_telefone(text) TO authenticated, service_role;

-- Recria a view incluindo wa_status = 'telefone_invalido' já é só passthrough de status;
-- nada a mudar na view (ela já lê l.status as-is).

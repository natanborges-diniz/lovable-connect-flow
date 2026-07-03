CREATE OR REPLACE FUNCTION public.regua_listar_pins_por_usuario(p_aba text DEFAULT 'aguardando'::text)
RETURNS TABLE(
  id uuid,
  nome_cliente text,
  cpf text,
  whatsapp text,
  cod_empresa text,
  nome_loja text,
  numero_venda text,
  valor_total_informado numeric,
  pin_expira_at timestamp with time zone,
  pin_tentativas smallint,
  pin_confirmado_at timestamp with time zone,
  status text,
  criado_em timestamp with time zone,
  cashback_ativado numeric,
  cashback_libera date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_acesso_total boolean := false;
  v_lojas text[] := ARRAY[]::text[];
  v_cods text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(ua.acesso_total, false), COALESCE(ua.lojas, ARRAY[]::text[])
    INTO v_acesso_total, v_lojas
  FROM public.user_acessos ua
  WHERE ua.user_id = v_uid;

  IF NOT v_acesso_total THEN
    IF v_lojas IS NULL OR array_length(v_lojas, 1) IS NULL THEN
      RETURN;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT tl.cod_empresa), ARRAY[]::text[])
      INTO v_cods
    FROM public.telefones_lojas tl
    WHERE tl.tipo = 'loja'
      AND tl.ativo = true
      AND tl.cod_empresa IS NOT NULL
      AND (
        tl.nome_loja = ANY(v_lojas)
        OR lower(trim(tl.nome_loja)) = ANY(
          SELECT lower(trim(x)) FROM unnest(v_lojas) AS x
        )
      );

    -- Fallback defensivo: se por algum motivo a ponte nome->código falhar,
    -- ainda permite comparar diretamente contra o nome resolvido da inscrição.
    IF array_length(v_cods, 1) IS NULL THEN
      v_cods := ARRAY[]::text[];
    END IF;
  END IF;

  RETURN QUERY
  WITH nomes AS (
    SELECT DISTINCT ON (tl.cod_empresa)
      tl.cod_empresa AS ce,
      tl.nome_loja AS nl
    FROM public.telefones_lojas tl
    WHERE tl.tipo = 'loja'
      AND tl.ativo = true
      AND tl.cod_empresa IS NOT NULL
    ORDER BY tl.cod_empresa, tl.nome_loja
  ),
  cc AS (
    SELECT
      cc0.inscricao_id AS ins_id,
      SUM(cc0.valor_gerado) FILTER (WHERE cc0.status = 'ativo') AS valor_ativo,
      MIN(cc0.liberado_em) FILTER (WHERE cc0.status = 'ativo') AS libera
    FROM public.cashback_credito cc0
    GROUP BY cc0.inscricao_id
  )
  SELECT
    r.id,
    r.nome_cliente,
    r.cpf,
    r.whatsapp,
    r.cod_empresa,
    n.nl,
    r.numero_venda,
    r.valor_total_informado,
    r.pin_expira_at,
    r.pin_tentativas,
    r.pin_confirmado_at,
    r.status,
    r.criado_em,
    cc.valor_ativo,
    cc.libera
  FROM public.regua_inscricao r
  LEFT JOIN nomes n ON n.ce = r.cod_empresa
  LEFT JOIN cc ON cc.ins_id = r.id
  WHERE r.status = 'ativa'
    AND (
      v_acesso_total
      OR r.cod_empresa = ANY(v_cods)
      OR lower(trim(COALESCE(n.nl, ''))) = ANY(
        SELECT lower(trim(x)) FROM unnest(v_lojas) AS x
      )
    )
    AND CASE p_aba
      WHEN 'aguardando' THEN
        r.pin_confirmado_at IS NULL
        AND r.pin_hash IS NOT NULL
        AND r.pin_expira_at > now()
        AND COALESCE(r.pin_tentativas, 0) < 3
      WHEN 'expirados' THEN
        r.pin_confirmado_at IS NULL
        AND (
          r.pin_hash IS NULL
          OR r.pin_expira_at <= now()
          OR COALESCE(r.pin_tentativas, 0) >= 3
        )
      WHEN 'confirmados_hoje' THEN
        r.pin_confirmado_at IS NOT NULL
        AND r.pin_confirmado_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
      ELSE false
    END
  ORDER BY r.criado_em DESC
  LIMIT 500;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.regua_listar_pins_por_usuario(text) TO anon, authenticated, service_role;
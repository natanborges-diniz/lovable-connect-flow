
-- RPC segura para o Messenger listar inscrições pendentes de PIN e reenvio,
-- respeitando escopo por loja do usuário (user_acessos.lojas -> telefones_lojas.cod_empresa).

CREATE OR REPLACE FUNCTION public.regua_listar_pins_por_usuario(
  p_aba text DEFAULT 'aguardando'  -- 'aguardando' | 'expirados' | 'confirmados_hoje'
)
RETURNS TABLE (
  id uuid,
  nome_cliente text,
  cpf text,
  whatsapp text,
  cod_empresa text,
  nome_loja text,
  numero_venda text,
  valor_total_informado numeric,
  pin_expira_at timestamptz,
  pin_tentativas smallint,
  pin_confirmado_at timestamptz,
  status text,
  criado_em timestamptz,
  cashback_ativado numeric,
  cashback_libera date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_acesso_total boolean := false;
  v_lojas text[] := ARRAY[]::text[];
  v_cods text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(acesso_total,false), COALESCE(lojas, ARRAY[]::text[])
    INTO v_acesso_total, v_lojas
  FROM public.user_acessos
  WHERE user_id = v_uid;

  IF NOT v_acesso_total THEN
    IF v_lojas IS NULL OR array_length(v_lojas,1) IS NULL THEN
      RETURN;
    END IF;
    SELECT COALESCE(array_agg(DISTINCT tl.cod_empresa), ARRAY[]::text[])
      INTO v_cods
    FROM public.telefones_lojas tl
    WHERE tl.tipo = 'loja'
      AND tl.ativo = true
      AND tl.cod_empresa IS NOT NULL
      AND tl.nome_loja = ANY(v_lojas);
    IF array_length(v_cods,1) IS NULL THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  WITH nomes AS (
    SELECT DISTINCT ON (tl.cod_empresa) tl.cod_empresa, tl.nome_loja
    FROM public.telefones_lojas tl
    WHERE tl.tipo='loja' AND tl.cod_empresa IS NOT NULL
  ),
  cc AS (
    SELECT inscricao_id,
           SUM(valor_gerado) FILTER (WHERE status='ativo') AS valor_ativo,
           MIN(liberado_em)   FILTER (WHERE status='ativo') AS libera
    FROM public.cashback_credito
    GROUP BY inscricao_id
  )
  SELECT r.id, r.nome_cliente, r.cpf, r.whatsapp, r.cod_empresa,
         n.nome_loja,
         r.numero_venda, r.valor_total_informado,
         r.pin_expira_at, r.pin_tentativas, r.pin_confirmado_at,
         r.status, r.criado_em,
         cc.valor_ativo, cc.libera
  FROM public.regua_inscricao r
  LEFT JOIN nomes n ON n.cod_empresa = r.cod_empresa
  LEFT JOIN cc ON cc.inscricao_id = r.id
  WHERE r.status = 'ativa'
    AND (v_acesso_total OR r.cod_empresa = ANY(v_cods))
    AND CASE p_aba
          WHEN 'aguardando' THEN
            r.pin_confirmado_at IS NULL
            AND r.pin_hash IS NOT NULL
            AND r.pin_expira_at > now()
            AND COALESCE(r.pin_tentativas,0) < 3
          WHEN 'expirados' THEN
            r.pin_confirmado_at IS NULL
            AND (
              r.pin_hash IS NULL
              OR r.pin_expira_at <= now()
              OR COALESCE(r.pin_tentativas,0) >= 3
            )
          WHEN 'confirmados_hoje' THEN
            r.pin_confirmado_at IS NOT NULL
            AND r.pin_confirmado_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
          ELSE false
        END
  ORDER BY r.criado_em DESC
  LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.regua_listar_pins_por_usuario(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regua_listar_pins_por_usuario(text) TO authenticated, service_role;

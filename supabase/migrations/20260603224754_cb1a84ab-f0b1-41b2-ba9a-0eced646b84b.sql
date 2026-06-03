
CREATE OR REPLACE FUNCTION public.cashback_consultar_saldo(_contato_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _saldo_usavel numeric := 0;
  _saldo_carencia numeric := 0;
  _prox_venc date;
  _prox_lib date;
  _total_usado numeric := 0;
  _creditos jsonb := '[]'::jsonb;
  _estado text;
BEGIN
  IF _contato_id IS NULL THEN
    RETURN jsonb_build_object(
      'estado_geral','nenhum',
      'saldo_usavel',0,
      'saldo_em_carencia',0,
      'proximo_vencimento',null,
      'proxima_liberacao',null,
      'total_usado',0,
      'creditos','[]'::jsonb
    );
  END IF;

  SELECT
    COALESCE(SUM(saldo) FILTER (WHERE COALESCE(liberado_em, data_geracao) <= _hoje), 0),
    COALESCE(SUM(saldo) FILTER (WHERE liberado_em > _hoje), 0),
    MIN(data_expiracao) FILTER (WHERE COALESCE(liberado_em, data_geracao) <= _hoje),
    MIN(liberado_em) FILTER (WHERE liberado_em > _hoje)
  INTO _saldo_usavel, _saldo_carencia, _prox_venc, _prox_lib
  FROM public.cashback_credito
  WHERE contato_id = _contato_id
    AND status = 'ativo'
    AND saldo > 0;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'saldo', saldo,
    'liberado_em', liberado_em,
    'data_expiracao', data_expiracao,
    'estado', CASE WHEN COALESCE(liberado_em, data_geracao) <= _hoje THEN 'ativo' ELSE 'em_carencia' END
  ) ORDER BY data_expiracao NULLS LAST), '[]'::jsonb)
  INTO _creditos
  FROM public.cashback_credito
  WHERE contato_id = _contato_id
    AND status = 'ativo'
    AND saldo > 0;

  SELECT COALESCE(SUM(valor_usado), 0)
  INTO _total_usado
  FROM public.cashback_resgate
  WHERE contato_id = _contato_id;

  _estado := CASE
    WHEN _saldo_usavel > 0 THEN 'ativo'
    WHEN _saldo_carencia > 0 THEN 'em_carencia'
    ELSE 'nenhum'
  END;

  RETURN jsonb_build_object(
    'estado_geral', _estado,
    'saldo_usavel', _saldo_usavel,
    'saldo_em_carencia', _saldo_carencia,
    'proximo_vencimento', _prox_venc,
    'proxima_liberacao', _prox_lib,
    'total_usado', _total_usado,
    'creditos', _creditos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cashback_consultar_saldo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cashback_consultar_saldo(uuid) TO authenticated, service_role;

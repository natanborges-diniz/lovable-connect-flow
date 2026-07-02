CREATE OR REPLACE FUNCTION public.cashback_dashboard_kpis(_de date DEFAULT ((now() - '30 days'::interval))::date, _ate date DEFAULT (now())::date, _lojas text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb;
  _kpis jsonb;
  _por_loja jsonb;
  _serie jsonb;
  _cods text[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'access denied';
  END IF;

  IF _lojas IS NOT NULL AND array_length(_lojas, 1) > 0 THEN
    SELECT array_agg(DISTINCT cod_empresa)
      INTO _cods
      FROM telefones_lojas
     WHERE nome_loja = ANY(_lojas)
       AND cod_empresa IS NOT NULL;
  END IF;

  WITH insc AS (
    SELECT * FROM regua_inscricao
    WHERE criado_em::date BETWEEN _de AND _ate
      AND (_cods IS NULL OR cod_empresa = ANY(_cods))
  ),
  cred AS (
    SELECT c.* FROM cashback_credito c
    JOIN regua_inscricao i ON i.id = c.inscricao_id
    WHERE i.criado_em::date BETWEEN _de AND _ate
      AND (_cods IS NULL OR i.cod_empresa = ANY(_cods))
  ),
  resg AS (
    SELECT r.* FROM cashback_resgate r
    LEFT JOIN cashback_credito cc ON cc.id = r.credito_id
    LEFT JOIN regua_inscricao ii ON ii.id = cc.inscricao_id
    WHERE r.data_uso::date BETWEEN _de AND _ate
      AND (_cods IS NULL OR ii.cod_empresa = ANY(_cods))
  ),
  vendas_com_resgate AS (
    SELECT r.numero_venda_uso,
           sum(r.valor_usado) AS desconto,
           (SELECT vi.valor_total_informado
              FROM regua_inscricao vi
             WHERE vi.numero_venda = r.numero_venda_uso
             ORDER BY vi.criado_em DESC
             LIMIT 1) AS valor_venda
    FROM resg r
    WHERE r.numero_venda_uso IS NOT NULL
    GROUP BY r.numero_venda_uso
  ),
  cred_ativos_all AS (
    SELECT c.* FROM cashback_credito c
    LEFT JOIN regua_inscricao i ON i.id = c.inscricao_id
    WHERE c.status = 'ativo' AND c.saldo > 0
      AND (_cods IS NULL OR i.cod_empresa = ANY(_cods))
  )
  SELECT jsonb_build_object(
    'vendas_inscritas', (SELECT count(*) FROM insc),
    'valor_lancado', COALESCE((SELECT sum(valor_total_informado) FROM insc), 0),
    'pin_confirmados', (SELECT count(*) FROM insc WHERE pin_confirmado_at IS NOT NULL),
    'pin_expirados', (SELECT count(*) FROM insc WHERE pin_confirmado_at IS NULL AND pin_expira_at < now()),
    'taxa_confirmacao_pin', CASE WHEN (SELECT count(*) FROM insc) > 0
      THEN round(100.0 * (SELECT count(*) FROM insc WHERE pin_confirmado_at IS NOT NULL) / (SELECT count(*) FROM insc), 1)
      ELSE 0 END,
    'match', (SELECT count(*) FROM insc WHERE valor_status = 'match'),
    'divergente', (SELECT count(*) FROM insc WHERE valor_status = 'divergente'),
    'sem_venda', (SELECT count(*) FROM insc WHERE valor_status = 'sem_venda_persistente'),
    'creditos_gerados_valor', COALESCE((SELECT sum(valor_gerado) FROM cred), 0),
    'creditos_ativos_qtd', (SELECT count(*) FROM cred_ativos_all),
    'creditos_ativos_saldo', COALESCE((SELECT sum(saldo) FROM cred_ativos_all), 0),
    'creditos_vencidos_valor', COALESCE((SELECT sum(c.valor_gerado)
        FROM cashback_credito c
        LEFT JOIN regua_inscricao i ON i.id = c.inscricao_id
        WHERE c.status = 'expirado' AND c.data_expiracao BETWEEN _de AND _ate
          AND (_cods IS NULL OR i.cod_empresa = ANY(_cods))), 0),
    'a_vencer_30d_qtd', (SELECT count(*) FROM cred_ativos_all WHERE data_expiracao <= (now() + interval '30 days')::date),
    'a_vencer_30d_valor', COALESCE((SELECT sum(saldo) FROM cred_ativos_all WHERE data_expiracao <= (now() + interval '30 days')::date), 0),
    'resgates_qtd', (SELECT count(*) FROM resg),
    'resgates_valor', COALESCE((SELECT sum(valor_usado) FROM resg), 0),
    'ticket_medio_resgate', CASE WHEN (SELECT count(*) FROM resg) > 0
      THEN round((SELECT sum(valor_usado) FROM resg) / (SELECT count(*) FROM resg), 2)
      ELSE 0 END,
    'vendas_com_resgate_qtd', (SELECT count(*) FROM vendas_com_resgate),
    'vendas_com_resgate_valor', COALESCE((SELECT sum(valor_venda) FROM vendas_com_resgate), 0),
    'desconto_concedido_valor', COALESCE((SELECT sum(valor_usado) FROM resg), 0),
    'ticket_medio_venda_resgate', CASE WHEN (SELECT count(*) FROM vendas_com_resgate WHERE valor_venda IS NOT NULL) > 0
      THEN round((SELECT sum(valor_venda) FROM vendas_com_resgate WHERE valor_venda IS NOT NULL) /
                 (SELECT count(*) FROM vendas_com_resgate WHERE valor_venda IS NOT NULL), 2)
      ELSE 0 END,
    'desconto_medio_pct', CASE WHEN COALESCE((SELECT sum(valor_venda) FROM vendas_com_resgate WHERE valor_venda IS NOT NULL), 0) > 0
      THEN round(100.0 * (SELECT sum(valor_usado) FROM resg WHERE numero_venda_uso IN (SELECT numero_venda_uso FROM vendas_com_resgate WHERE valor_venda IS NOT NULL)) /
                 (SELECT sum(valor_venda) FROM vendas_com_resgate WHERE valor_venda IS NOT NULL), 1)
      ELSE 0 END,
    'conversao_pct', CASE WHEN (SELECT count(DISTINCT c.contato_id)
        FROM cashback_credito c
        LEFT JOIN regua_inscricao i ON i.id = c.inscricao_id
        WHERE c.status IN ('ativo','utilizado','expirado')
          AND (_cods IS NULL OR i.cod_empresa = ANY(_cods))) > 0
      THEN round(100.0 *
        (SELECT count(DISTINCT r.contato_id)
           FROM cashback_resgate r
           LEFT JOIN cashback_credito cc ON cc.id = r.credito_id
           LEFT JOIN regua_inscricao ii ON ii.id = cc.inscricao_id
           WHERE (_cods IS NULL OR ii.cod_empresa = ANY(_cods))) /
        (SELECT count(DISTINCT c.contato_id)
           FROM cashback_credito c
           LEFT JOIN regua_inscricao i ON i.id = c.inscricao_id
           WHERE c.status IN ('ativo','utilizado','expirado')
             AND (_cods IS NULL OR i.cod_empresa = ANY(_cods))), 1)
      ELSE 0 END
  ) INTO _kpis;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.vendas DESC), '[]'::jsonb)
  INTO _por_loja
  FROM (
    SELECT
      i.cod_empresa,
      COALESCE((SELECT nome_loja FROM telefones_lojas tl WHERE tl.cod_empresa = i.cod_empresa LIMIT 1), 'Sem loja') AS nome_loja,
      count(*) AS vendas,
      COALESCE(sum(i.valor_total_informado), 0) AS valor_lancado,
      count(*) FILTER (WHERE i.valor_status = 'match') AS match,
      count(*) FILTER (WHERE i.valor_status = 'divergente') AS divergente,
      count(*) FILTER (WHERE i.valor_status = 'sem_venda_persistente') AS sem_venda,
      count(*) FILTER (WHERE i.pin_confirmado_at IS NOT NULL) AS pin_ok,
      COALESCE(sum(c.valor_gerado), 0) AS cashback_gerado,
      COALESCE((
        SELECT sum(r.valor_usado) FROM cashback_resgate r
        JOIN cashback_credito cc ON cc.id = r.credito_id
        JOIN regua_inscricao ii ON ii.id = cc.inscricao_id
        WHERE ii.cod_empresa = i.cod_empresa
          AND r.data_uso::date BETWEEN _de AND _ate
      ), 0) AS cashback_resgatado
    FROM regua_inscricao i
    LEFT JOIN cashback_credito c ON c.inscricao_id = i.id
    WHERE i.criado_em::date BETWEEN _de AND _ate
      AND (_cods IS NULL OR i.cod_empresa = ANY(_cods))
    GROUP BY i.cod_empresa
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.semana), '[]'::jsonb)
  INTO _serie
  FROM (
    SELECT
      date_trunc('week', d)::date AS semana,
      COALESCE((
        SELECT sum(c.valor_gerado)
          FROM cashback_credito c
          LEFT JOIN regua_inscricao i ON i.id = c.inscricao_id
         WHERE date_trunc('week', c.criado_em)::date = date_trunc('week', d)::date
           AND (_cods IS NULL OR i.cod_empresa = ANY(_cods))
      ), 0) AS gerado,
      COALESCE((
        SELECT sum(r.valor_usado)
          FROM cashback_resgate r
          LEFT JOIN cashback_credito cc ON cc.id = r.credito_id
          LEFT JOIN regua_inscricao ii ON ii.id = cc.inscricao_id
         WHERE date_trunc('week', r.data_uso)::date = date_trunc('week', d)::date
           AND (_cods IS NULL OR ii.cod_empresa = ANY(_cods))
      ), 0) AS resgatado
    FROM generate_series(_de, _ate, interval '7 days') d
  ) s;

  _result := jsonb_build_object(
    'periodo', jsonb_build_object('de', _de, 'ate', _ate),
    'kpis', _kpis,
    'por_loja', _por_loja,
    'serie_semanal', _serie
  );

  RETURN _result;
END;
$function$;
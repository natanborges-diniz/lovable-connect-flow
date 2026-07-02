CREATE OR REPLACE FUNCTION public.cashback_clientes_consolidado(
  _busca text DEFAULT NULL,
  _lojas text[] DEFAULT NULL,
  _limit int DEFAULT 200
)
RETURNS TABLE(
  contato_id uuid,
  nome text,
  cpf text,
  whatsapp text,
  ultima_loja text,
  total_vendas int,
  valor_total_vendas numeric,
  saldo_a_vencer numeric,
  saldo_vencido numeric,
  saldo_utilizado numeric,
  proxima_expiracao date,
  ultima_venda_em timestamptz,
  creditos jsonb,
  vendas jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_codes text[];
BEGIN
  IF _lojas IS NOT NULL AND array_length(_lojas,1) IS NOT NULL THEN
    SELECT array_agg(DISTINCT tl.cod_empresa::text)
      INTO v_codes
      FROM public.telefones_lojas tl
      WHERE tl.nome_loja = ANY(_lojas);
  END IF;

  RETURN QUERY
  WITH lojas_map AS (
    SELECT DISTINCT ON (tl.cod_empresa::text) tl.cod_empresa::text AS cod, tl.nome_loja
    FROM public.telefones_lojas tl
    WHERE tl.nome_loja IS NOT NULL
    ORDER BY tl.cod_empresa::text, tl.id
  ),
  base AS (
    SELECT
      ri.contato_id,
      ri.nome_cliente,
      ri.cpf,
      ri.whatsapp,
      ri.cod_empresa,
      COALESCE(lm.nome_loja, ri.cod_empresa) AS nome_loja,
      ri.numero_venda,
      ri.valor_total_informado,
      ri.status,
      ri.criado_em,
      ri.pin_confirmado_at,
      ri.id AS inscricao_id
    FROM public.regua_inscricao ri
    LEFT JOIN lojas_map lm ON lm.cod = ri.cod_empresa
    WHERE ri.contato_id IS NOT NULL
      AND (
        _busca IS NULL OR _busca = '' OR
        ri.nome_cliente ILIKE '%'||_busca||'%' OR
        regexp_replace(coalesce(ri.cpf,''),'\D','','g') LIKE '%'||regexp_replace(_busca,'\D','','g')||'%' OR
        regexp_replace(coalesce(ri.whatsapp,''),'\D','','g') LIKE '%'||regexp_replace(_busca,'\D','','g')||'%'
      )
      AND (v_codes IS NULL OR ri.cod_empresa = ANY(v_codes))
  ),
  creditos_agg AS (
    SELECT
      cc.contato_id,
      COALESCE(SUM(CASE WHEN cc.status='ativo' AND cc.data_expiracao >= CURRENT_DATE THEN cc.saldo ELSE 0 END),0) AS saldo_a_vencer,
      COALESCE(SUM(CASE WHEN cc.data_expiracao < CURRENT_DATE AND cc.saldo > 0 THEN cc.saldo ELSE 0 END),0) AS saldo_vencido,
      COALESCE(SUM(cc.valor_gerado - cc.saldo),0) AS saldo_utilizado,
      MIN(CASE WHEN cc.status='ativo' AND cc.data_expiracao >= CURRENT_DATE AND cc.saldo > 0 THEN cc.data_expiracao END) AS proxima_expiracao,
      jsonb_agg(jsonb_build_object(
        'id', cc.id,
        'valor_gerado', cc.valor_gerado,
        'saldo', cc.saldo,
        'status', cc.status,
        'data_geracao', cc.data_geracao,
        'data_expiracao', cc.data_expiracao,
        'liberado_em', cc.liberado_em,
        'vencido', (cc.data_expiracao < CURRENT_DATE AND cc.saldo > 0)
      ) ORDER BY cc.data_expiracao) AS creditos
    FROM public.cashback_credito cc
    WHERE cc.contato_id IN (SELECT DISTINCT b.contato_id FROM base b)
    GROUP BY cc.contato_id
  ),
  vendas_agg AS (
    SELECT
      b.contato_id,
      MAX(b.nome_cliente) AS nome,
      MAX(b.cpf) AS cpf,
      MAX(b.whatsapp) AS whatsapp,
      (array_agg(b.nome_loja ORDER BY b.criado_em DESC))[1] AS ultima_loja,
      COUNT(*)::int AS total_vendas,
      COALESCE(SUM(b.valor_total_informado),0) AS valor_total_vendas,
      MAX(b.criado_em) AS ultima_venda_em,
      jsonb_agg(jsonb_build_object(
        'inscricao_id', b.inscricao_id,
        'numero_venda', b.numero_venda,
        'valor', b.valor_total_informado,
        'status', b.status,
        'criado_em', b.criado_em,
        'pin_confirmado_at', b.pin_confirmado_at,
        'cod_empresa', b.cod_empresa,
        'nome_loja', b.nome_loja
      ) ORDER BY b.criado_em DESC) AS vendas
    FROM base b
    GROUP BY b.contato_id
  )
  SELECT
    v.contato_id, v.nome, v.cpf, v.whatsapp, v.ultima_loja,
    v.total_vendas, v.valor_total_vendas,
    COALESCE(c.saldo_a_vencer,0), COALESCE(c.saldo_vencido,0), COALESCE(c.saldo_utilizado,0),
    c.proxima_expiracao, v.ultima_venda_em,
    COALESCE(c.creditos,'[]'::jsonb), v.vendas
  FROM vendas_agg v
  LEFT JOIN creditos_agg c ON c.contato_id = v.contato_id
  ORDER BY v.ultima_venda_em DESC
  LIMIT _limit;
END;
$$;
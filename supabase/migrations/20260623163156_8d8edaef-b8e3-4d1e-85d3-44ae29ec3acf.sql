
-- Painel de Disparos CRM: view unificada + RPC de KPIs + config + grants (admin-only)

-- 1) View consolidada
CREATE OR REPLACE VIEW public.vw_disparos_unificados AS
WITH armacao AS (
  SELECT
    l.id,
    'armacao'::text AS fonte,
    COALESCE(l.template_alias, 'aviso_aguardando_armacao') AS template_nome,
    l.template_alias AS alias,
    c.nome AS cliente_nome,
    COALESCE(l.cliente_telefone, c.telefone) AS telefone,
    l.loja_nome,
    NULL::uuid AS atendimento_id,
    l.contato_id,
    l.enviado_at,
    l.status AS wa_status,
    l.enviado_at AS wa_status_at,
    CASE WHEN l.status = 'error' THEN COALESCE(l.payload->>'error', l.payload->>'motivo') END AS falha_motivo,
    l.payload AS params,
    l.payload->>'whatsapp_message_id' AS whatsapp_message_id
  FROM public.os_avisos_armacao_log l
  LEFT JOIN public.contatos c ON c.id = l.contato_id
),
entrega AS (
  SELECT
    r.id,
    'entrega'::text AS fonte,
    COALESCE(r.notificado_cliente_template, 'os_recebida_loja') AS template_nome,
    r.notificado_cliente_template AS alias,
    r.cliente_nome,
    r.cliente_telefone,
    r.loja_nome,
    NULL::uuid AS atendimento_id,
    r.contato_id,
    r.notificado_cliente_at AS enviado_at,
    CASE WHEN r.notificado_cliente_at IS NOT NULL THEN 'sent' ELSE NULL END AS wa_status,
    r.notificado_cliente_at AS wa_status_at,
    NULL::text AS falha_motivo,
    r.metadata AS params,
    r.metadata->>'whatsapp_message_id' AS whatsapp_message_id
  FROM public.os_recebimento_loja r
  WHERE r.notificado_cliente_at IS NOT NULL
),
regua AS (
  SELECT
    t.id,
    'regua'::text AS fonte,
    COALESCE(t.template_key, t.tipo) AS template_nome,
    t.template_key AS alias,
    i.nome_cliente AS cliente_nome,
    i.whatsapp AS telefone,
    NULL::text AS loja_nome,
    NULL::uuid AS atendimento_id,
    i.contato_id,
    t.enviado_at,
    COALESCE(t.status_entrega, t.status) AS wa_status,
    t.enviado_at AS wa_status_at,
    NULL::text AS falha_motivo,
    NULL::jsonb AS params,
    NULL::text AS whatsapp_message_id
  FROM public.regua_touchpoint t
  LEFT JOIN public.regua_inscricao i ON i.id = t.inscricao_id
  WHERE t.enviado_at IS NOT NULL
),
pagamento AS (
  SELECT
    p.id,
    'pagamento'::text AS fonte,
    'link_pagamento'::text AS template_nome,
    NULL::text AS alias,
    p.cliente_nome,
    p.cliente_telefone,
    p.loja_nome,
    p.atendimento_id,
    p.contato_id,
    p.enviado_at,
    p.status AS wa_status,
    COALESCE(p.pago_at, p.enviado_at) AS wa_status_at,
    NULL::text AS falha_motivo,
    p.metadata AS params,
    p.metadata->>'whatsapp_message_id' AS whatsapp_message_id
  FROM public.pagamentos_link p
  WHERE p.enviado_at IS NOT NULL
),
mensageria AS (
  SELECT
    m.id,
    COALESCE(
      CASE
        WHEN (m.metadata->>'template_name') ILIKE 'cashback%' THEN 'cashback'
        WHEN (m.metadata->>'template_name') ILIKE '%agendamento%' OR (m.metadata->>'template_name') ILIKE '%lembrete%' OR (m.metadata->>'template_name') ILIKE '%confirma%' THEN 'agendamento'
        WHEN (m.metadata->>'template_name') ILIKE 'retomada%' OR (m.metadata->>'template_name') ILIKE 'recupera%' THEN 'recuperacao'
        WHEN (m.metadata->>'template_name') ILIKE '%os_%' OR (m.metadata->>'template_name') ILIKE '%retirar%' THEN 'entrega'
        ELSE 'outro'
      END
    , 'outro')::text AS fonte,
    (m.metadata->>'template_name') AS template_nome,
    (m.metadata->>'template_alias') AS alias,
    c.nome AS cliente_nome,
    c.telefone,
    NULL::text AS loja_nome,
    m.atendimento_id,
    a.contato_id,
    m.created_at AS enviado_at,
    COALESCE(m.metadata->>'last_status', 'sent') AS wa_status,
    COALESCE((m.metadata->>'last_status_at')::timestamptz, m.created_at) AS wa_status_at,
    (m.metadata->>'error_message') AS falha_motivo,
    m.metadata AS params,
    (m.metadata->>'whatsapp_message_id') AS whatsapp_message_id
  FROM public.mensagens m
  LEFT JOIN public.atendimentos a ON a.id = m.atendimento_id
  LEFT JOIN public.contatos c ON c.id = a.contato_id
  WHERE m.direcao = 'outbound'
    AND (m.metadata ? 'template_name')
    AND m.deletada_at IS NULL
)
SELECT * FROM armacao
UNION ALL SELECT * FROM entrega
UNION ALL SELECT * FROM regua
UNION ALL SELECT * FROM pagamento
UNION ALL SELECT * FROM mensageria;

-- 2) Grants (admin-only — RLS controla na origem)
REVOKE ALL ON public.vw_disparos_unificados FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_disparos_unificados TO authenticated, service_role;

-- 3) RPC de KPIs (security definer, checa admin)
CREATE OR REPLACE FUNCTION public.disparos_kpis(periodo_dias integer DEFAULT 7, fontes text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_entregues integer := 0;
  v_lidos integer := 0;
  v_invalidos integer := 0;
  v_falhas integer := 0;
  v_respondidos integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT
    count(*) FILTER (WHERE 1=1),
    count(*) FILTER (WHERE wa_status IN ('delivered','read','sent')),
    count(*) FILTER (WHERE wa_status = 'read'),
    count(*) FILTER (WHERE wa_status IN ('invalid_number','invalid')),
    count(*) FILTER (WHERE wa_status IN ('failed','error'))
  INTO v_total, v_entregues, v_lidos, v_invalidos, v_falhas
  FROM public.vw_disparos_unificados
  WHERE enviado_at >= now() - make_interval(days => periodo_dias)
    AND (fontes IS NULL OR fonte = ANY(fontes));

  SELECT count(DISTINCT d.id)
  INTO v_respondidos
  FROM public.vw_disparos_unificados d
  JOIN public.mensagens m ON m.atendimento_id = d.atendimento_id
   AND m.direcao = 'inbound'
   AND m.created_at BETWEEN d.enviado_at AND d.enviado_at + interval '24 hours'
  WHERE d.enviado_at >= now() - make_interval(days => periodo_dias)
    AND (fontes IS NULL OR d.fonte = ANY(fontes))
    AND d.atendimento_id IS NOT NULL;

  RETURN jsonb_build_object(
    'total', v_total,
    'entregues', v_entregues,
    'lidos', v_lidos,
    'invalidos', v_invalidos,
    'falhas', v_falhas,
    'respondidos_24h', v_respondidos,
    'taxa_entrega', CASE WHEN v_total > 0 THEN round(v_entregues::numeric * 100 / v_total, 1) ELSE 0 END,
    'taxa_leitura', CASE WHEN v_total > 0 THEN round(v_lidos::numeric * 100 / v_total, 1) ELSE 0 END,
    'taxa_resposta_24h', CASE WHEN v_total > 0 THEN round(v_respondidos::numeric * 100 / v_total, 1) ELSE 0 END,
    'taxa_invalido', CASE WHEN v_total > 0 THEN round(v_invalidos::numeric * 100 / v_total, 1) ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.disparos_kpis(integer, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disparos_kpis(integer, text[]) TO authenticated;

-- 4) RPC para listagem paginada (admin-only)
CREATE OR REPLACE FUNCTION public.disparos_listar(
  periodo_dias integer DEFAULT 7,
  fontes text[] DEFAULT NULL,
  status_filtro text[] DEFAULT NULL,
  busca text DEFAULT NULL,
  pagina integer DEFAULT 1,
  por_pagina integer DEFAULT 50
)
RETURNS SETOF public.vw_disparos_unificados
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.vw_disparos_unificados
  WHERE enviado_at >= now() - make_interval(days => periodo_dias)
    AND (fontes IS NULL OR fonte = ANY(fontes))
    AND (status_filtro IS NULL OR wa_status = ANY(status_filtro))
    AND (
      busca IS NULL OR busca = ''
      OR cliente_nome ILIKE '%' || busca || '%'
      OR telefone ILIKE '%' || busca || '%'
      OR template_nome ILIKE '%' || busca || '%'
      OR loja_nome ILIKE '%' || busca || '%'
    )
  ORDER BY enviado_at DESC
  LIMIT GREATEST(por_pagina, 1)
  OFFSET GREATEST((pagina - 1) * por_pagina, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.disparos_listar(integer, text[], text[], text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disparos_listar(integer, text[], text[], text, integer, integer) TO authenticated;

-- 5) Config
INSERT INTO public.app_config(key, value)
VALUES ('disparos_painel', '{"fontes_ativas":["armacao","regua","cashback","entrega","pagamento","agendamento","recuperacao","escalada"],"incluir_texto_livre_default":false,"periodo_default_dias":7}')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- Funil v2 — separa "no-show real" (loja marcou que não veio) de
-- "sem registro" (agendamento com data já passada e loja não informou
-- nada). Novos campos:
--   por_loja: sem_registro, no_show_total (no_show + sem_registro),
--             vencidos (agendamentos com data passada), pct_falta_total
--   kpis:     no_show, sem_registro, falta_total_pct (sobre vencidos)
-- "Sem registro": data_horario < now(), loja_confirmou_presenca IS NULL
-- e status ainda pré-visita (não conta cancelado/reagendado/abandonado,
-- que são desfechos conhecidos).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.funil_dashboard(
  _de date,
  _ate date,
  _lojas text[] DEFAULT NULL,
  _fontes text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fim timestamptz := (_ate + 1)::timestamptz;
  v_ini timestamptz := _de::timestamptz;
  v_funil jsonb;
  v_por_loja jsonb;
  v_por_fonte jsonb;
  v_serie jsonb;
  v_kpis jsonb;
BEGIN
  CREATE TEMP TABLE _coorte ON COMMIT DROP AS
  SELECT DISTINCT a.contato_id,
         COALESCE(NULLIF(ct.metadata->>'fonte_lead',''),'desconhecido') AS fonte
  FROM atendimentos a
  JOIN contatos ct ON ct.id = a.contato_id
  WHERE a.canal = 'whatsapp'
    AND a.created_at >= v_ini AND a.created_at < v_fim
    AND (_fontes IS NULL OR array_length(_fontes,1) IS NULL
         OR COALESCE(NULLIF(ct.metadata->>'fonte_lead',''),'desconhecido') = ANY(_fontes));

  CREATE TEMP TABLE _flags ON COMMIT DROP AS
  SELECT c.contato_id, c.fonte,
    EXISTS (SELECT 1 FROM eventos_crm e
            WHERE e.contato_id = c.contato_id
              AND e.created_at >= v_ini AND e.created_at < v_fim
              AND (e.tipo IN ('receita_interpretada','receita_confirmada_cliente',
                              'cta_visita_aceito','loja_escolhida')
                   OR e.tipo LIKE 'orcamento_%')) AS qualificado,
    EXISTS (SELECT 1 FROM eventos_crm e
            WHERE e.contato_id = c.contato_id
              AND e.created_at >= v_ini AND e.created_at < v_fim
              AND e.tipo IN ('escalonamento_humano','escalar_consultor')) AS escalado
  FROM _coorte c;

  CREATE TEMP TABLE _ag ON COMMIT DROP AS
  SELECT g.id, g.contato_id, g.loja_nome, g.status, g.created_at, g.data_horario,
         g.valor_venda, g.valor_orcamento, g.numero_venda,
         (g.loja_confirmou_presenca IS TRUE
          OR g.status IN ('compareceu','atendido','orcamento','venda_fechada')) AS compareceu,
         (g.status = 'venda_fechada') AS venda,
         (g.data_horario < now()) AS vencido,
         -- Loja não informou nada e a data já passou (status ainda pré-visita)
         (g.data_horario < now()
          AND g.loja_confirmou_presenca IS NULL
          AND g.status NOT IN ('compareceu','atendido','orcamento','venda_fechada',
                               'no_show','recuperacao','cancelado','reagendado','abandonado')) AS sem_registro,
         (c.contato_id IS NOT NULL) AS na_coorte
  FROM agendamentos g
  LEFT JOIN _coorte c ON c.contato_id = g.contato_id
  WHERE g.created_at >= v_ini AND g.created_at < v_fim
    AND (_lojas IS NULL OR array_length(_lojas,1) IS NULL OR g.loja_nome = ANY(_lojas))
    AND (_fontes IS NULL OR array_length(_fontes,1) IS NULL OR c.contato_id IS NOT NULL);

  SELECT jsonb_build_array(
    jsonb_build_object('etapa','Contato inicial','n',(SELECT count(*) FROM _coorte)),
    jsonb_build_object('etapa','Qualificado (IA)','n',(SELECT count(*) FROM _flags WHERE qualificado)),
    jsonb_build_object('etapa','Escalado p/ humano','n',(SELECT count(*) FROM _flags WHERE escalado)),
    jsonb_build_object('etapa','Agendou visita','n',(SELECT count(DISTINCT contato_id) FROM _ag)),
    jsonb_build_object('etapa','Compareceu na loja','n',(SELECT count(DISTINCT contato_id) FROM _ag WHERE compareceu)),
    jsonb_build_object('etapa','Venda fechada','n',(SELECT count(DISTINCT contato_id) FROM _ag WHERE venda),
                       'valor',(SELECT COALESCE(sum(valor_venda),0) FROM _ag WHERE venda))
  ) INTO v_funil;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.valor_vendas DESC NULLS LAST), '[]'::jsonb)
  INTO v_por_loja
  FROM (
    SELECT loja_nome AS loja,
           count(*) AS agendados,
           count(*) FILTER (WHERE vencido) AS vencidos,
           count(*) FILTER (WHERE compareceu) AS compareceram,
           count(*) FILTER (WHERE status = 'no_show') AS no_show,
           count(*) FILTER (WHERE sem_registro) AS sem_registro,
           count(*) FILTER (WHERE status = 'no_show' OR sem_registro) AS no_show_total,
           count(*) FILTER (WHERE venda) AS vendas,
           COALESCE(sum(valor_venda) FILTER (WHERE venda),0) AS valor_vendas,
           round(100.0 * count(*) FILTER (WHERE compareceu) / NULLIF(count(*),0), 1) AS pct_comparecimento,
           round(100.0 * count(*) FILTER (WHERE status = 'no_show' OR sem_registro)
                 / NULLIF(count(*) FILTER (WHERE vencido),0), 1) AS pct_falta_total,
           round(100.0 * count(*) FILTER (WHERE venda) / NULLIF(count(*) FILTER (WHERE compareceu),0), 1) AS pct_conversao_visita
    FROM _ag
    GROUP BY loja_nome
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.contatos DESC), '[]'::jsonb)
  INTO v_por_fonte
  FROM (
    SELECT f.fonte,
           count(*) AS contatos,
           count(*) FILTER (WHERE f.qualificado) AS qualificados,
           count(DISTINCT a.contato_id) AS agendaram,
           count(DISTINCT a.contato_id) FILTER (WHERE a.venda) AS venderam,
           COALESCE(sum(a.valor_venda) FILTER (WHERE a.venda),0) AS valor
    FROM _flags f
    LEFT JOIN _ag a ON a.contato_id = f.contato_id
    GROUP BY f.fonte
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.dia), '[]'::jsonb)
  INTO v_serie
  FROM (
    SELECT d.dia::date AS dia,
      (SELECT count(DISTINCT a2.contato_id) FROM atendimentos a2
        WHERE a2.canal='whatsapp' AND a2.created_at >= d.dia AND a2.created_at < d.dia + interval '1 day') AS contatos,
      (SELECT count(*) FROM _ag WHERE created_at >= d.dia AND created_at < d.dia + interval '1 day') AS agendamentos,
      (SELECT count(*) FROM eventos_crm e
        WHERE e.tipo='venda_fechada' AND e.created_at >= d.dia AND e.created_at < d.dia + interval '1 day'
          AND (_lojas IS NULL OR array_length(_lojas,1) IS NULL OR e.metadata->>'loja_nome' = ANY(_lojas))) AS vendas,
      (SELECT COALESCE(sum((e.metadata->>'valor_venda')::numeric),0) FROM eventos_crm e
        WHERE e.tipo='venda_fechada' AND e.created_at >= d.dia AND e.created_at < d.dia + interval '1 day'
          AND (_lojas IS NULL OR array_length(_lojas,1) IS NULL OR e.metadata->>'loja_nome' = ANY(_lojas))
          AND e.metadata->>'valor_venda' ~ '^[0-9.]+$') AS valor
    FROM generate_series(v_ini, v_fim - interval '1 day', interval '1 day') AS d(dia)
  ) t;

  SELECT jsonb_build_object(
    'contatos', (SELECT count(*) FROM _coorte),
    'vendas', (SELECT count(DISTINCT contato_id) FROM _ag WHERE venda),
    'valor_vendas', (SELECT COALESCE(sum(valor_venda),0) FROM _ag WHERE venda),
    'ticket_medio', (SELECT round(COALESCE(avg(valor_venda),0),2) FROM _ag WHERE venda AND valor_venda > 0),
    'conv_geral_pct', (SELECT round(100.0 * count(DISTINCT contato_id) FILTER (WHERE venda) / NULLIF((SELECT count(*) FROM _coorte),0), 1) FROM _ag),
    'no_show', (SELECT count(*) FROM _ag WHERE status='no_show'),
    'sem_registro', (SELECT count(*) FROM _ag WHERE sem_registro),
    'no_show_pct', (SELECT round(100.0 * count(*) FILTER (WHERE status='no_show') / NULLIF(count(*),0),1) FROM _ag),
    'falta_total_pct', (SELECT round(100.0 * count(*) FILTER (WHERE status='no_show' OR sem_registro)
                        / NULLIF(count(*) FILTER (WHERE vencido),0),1) FROM _ag),
    'faturamento_validado', (
      SELECT COALESCE(sum(ri.valor_total_validado),0)
      FROM regua_inscricao ri
      WHERE ri.criado_em >= v_ini AND ri.criado_em < v_fim
        AND (_lojas IS NULL OR array_length(_lojas,1) IS NULL OR ri.cod_empresa IN (
          SELECT DISTINCT tl.cod_empresa FROM telefones_lojas tl
          WHERE tl.nome_loja = ANY(_lojas) AND tl.cod_empresa IS NOT NULL))
    )
  ) INTO v_kpis;

  RETURN jsonb_build_object(
    'funil', v_funil,
    'por_loja', v_por_loja,
    'por_fonte', v_por_fonte,
    'serie', v_serie,
    'kpis', v_kpis
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.funil_dashboard(date, date, text[], text[]) TO authenticated;

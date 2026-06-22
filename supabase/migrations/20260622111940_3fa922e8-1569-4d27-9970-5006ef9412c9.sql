-- Visão Cliente 360: função SECURITY DEFINER que unifica timeline do contato
CREATE OR REPLACE FUNCTION public.contato_timeline(
  _contato_id uuid,
  _limit int DEFAULT 200,
  _offset int DEFAULT 0,
  _filtros text[] DEFAULT NULL
)
RETURNS TABLE(
  fonte text,
  tipo text,
  titulo text,
  descricao text,
  ocorrido_at timestamptz,
  referencia_tipo text,
  referencia_id uuid,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH unified AS (
    -- eventos_crm (PIN, telemetria de canais, consentimento, contato_*)
    SELECT 'evento_crm'::text AS fonte,
           e.tipo::text,
           CASE
             WHEN e.tipo LIKE 'contato_%' THEN replace(initcap(replace(e.tipo,'_',' ')), 'Contato ', '')
             ELSE initcap(replace(e.tipo,'_',' '))
           END AS titulo,
           e.descricao,
           e.created_at AS ocorrido_at,
           e.referencia_tipo,
           e.referencia_id,
           e.metadata
    FROM eventos_crm e
    WHERE e.contato_id = _contato_id

    UNION ALL
    -- atendimentos (início)
    SELECT 'atendimento', 'atendimento_iniciado',
           'Atendimento iniciado (' || COALESCE(a.canal::text,'') || ')',
           a.atendente_nome,
           COALESCE(a.inicio_at, a.created_at),
           'atendimento', a.id, a.metadata
    FROM atendimentos a WHERE a.contato_id = _contato_id

    UNION ALL
    -- atendimentos (fim)
    SELECT 'atendimento', 'atendimento_encerrado',
           'Atendimento encerrado',
           a.atendente_nome, a.fim_at,
           'atendimento', a.id, a.metadata
    FROM atendimentos a
    WHERE a.contato_id = _contato_id AND a.fim_at IS NOT NULL

    UNION ALL
    -- agendamentos (criação)
    SELECT 'agendamento', 'agendamento_criado',
           'Agendamento em ' || COALESCE(ag.loja_nome,'loja') ||
             ' para ' || to_char(ag.data_horario AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'),
           ag.observacoes, ag.created_at,
           'agendamento', ag.id, ag.metadata
    FROM agendamentos ag WHERE ag.contato_id = _contato_id

    UNION ALL
    -- agendamentos (status mudou)
    SELECT 'agendamento', 'agendamento_' || ag.status,
           'Status: ' || ag.status,
           ag.observacoes, ag.updated_at,
           'agendamento', ag.id, ag.metadata
    FROM agendamentos ag
    WHERE ag.contato_id = _contato_id
      AND ag.status IN ('confirmado','no_show','venda_fechada','cancelado','compareceu')

    UNION ALL
    -- cashback credito
    SELECT 'cashback', 'cashback_credito',
           'Cashback gerado: R$ ' || to_char(cc.valor_gerado,'FM999G990D00'),
           'Venda ' || COALESCE((SELECT numero_venda FROM regua_inscricao WHERE id=cc.inscricao_id),'—'),
           cc.criado_em,
           'cashback_credito', cc.id,
           jsonb_build_object('saldo',cc.saldo,'expira',cc.data_expiracao,'status',cc.status)
    FROM cashback_credito cc WHERE cc.contato_id = _contato_id

    UNION ALL
    -- cashback resgate
    SELECT 'cashback', 'cashback_resgate',
           'Cashback usado: R$ ' || to_char(cr.valor_usado,'FM999G990D00'),
           'Venda ' || COALESCE(cr.numero_venda_uso,'—'),
           cr.data_uso::timestamptz,
           'cashback_resgate', cr.id,
           jsonb_build_object('credito_id',cr.credito_id)
    FROM cashback_resgate cr WHERE cr.contato_id = _contato_id

    UNION ALL
    -- regua_inscricao (consentimento PIN)
    SELECT 'lgpd', 'consentimento_aceito',
           'Termos LGPD aceitos (' || COALESCE(ri.termos_versao,'?') || ')',
           'Canal: ' || COALESCE(ri.canal_consentimento,'—'),
           ri.pin_confirmado_at,
           'regua_inscricao', ri.id,
           jsonb_build_object('venda',ri.numero_venda,'ip',ri.ip_origem_consultor)
    FROM regua_inscricao ri
    WHERE ri.contato_id = _contato_id AND ri.pin_confirmado_at IS NOT NULL

    UNION ALL
    -- regua_touchpoint (disparos da régua)
    SELECT 'regua', 'regua_' || rt.tipo,
           'Régua: ' || rt.tipo,
           rt.template_key, COALESCE(rt.enviado_at, rt.data_prevista),
           'regua_touchpoint', rt.id,
           jsonb_build_object('canal',rt.canal,'status',rt.status,'entrega',rt.status_entrega)
    FROM regua_touchpoint rt
    JOIN regua_inscricao ri ON ri.id = rt.inscricao_id
    WHERE ri.contato_id = _contato_id

    UNION ALL
    -- pagamentos_link (criação e pagamento)
    SELECT 'pagamento', 'pagamento_criado',
           'Link de pagamento R$ ' || to_char(pl.valor,'FM999G990D00') || ' (' || COALESCE(pl.loja_nome,'') || ')',
           pl.descricao, pl.created_at,
           'pagamento_link', pl.id, pl.metadata
    FROM pagamentos_link pl WHERE pl.contato_id = _contato_id

    UNION ALL
    SELECT 'pagamento', 'pagamento_pago',
           'Pagamento confirmado (NSU ' || COALESCE(pl.nsu,'—') || ')',
           'Bandeira ' || COALESCE(pl.bandeira,'—'), pl.pago_at,
           'pagamento_link', pl.id, pl.metadata
    FROM pagamentos_link pl WHERE pl.contato_id = _contato_id AND pl.pago_at IS NOT NULL

    UNION ALL
    -- OS recebimento
    SELECT 'os', 'os_aguardando_armacao',
           'OS ' || or2.os_numero || ' aguardando armação (' || COALESCE(or2.loja_nome,'') || ')',
           or2.produto_descricao, or2.aviso_armacao_enviado_at,
           'os_recebimento', or2.id, or2.metadata
    FROM os_recebimento_loja or2
    WHERE or2.contato_id = _contato_id AND or2.aviso_armacao_enviado_at IS NOT NULL

    UNION ALL
    SELECT 'os', 'os_recebida_loja',
           'OS ' || or2.os_numero || ' recebida na loja',
           or2.produto_descricao, or2.recebido_at,
           'os_recebimento', or2.id, or2.metadata
    FROM os_recebimento_loja or2
    WHERE or2.contato_id = _contato_id AND or2.recebido_at IS NOT NULL

    UNION ALL
    -- demandas_loja
    SELECT 'demanda', 'demanda_aberta',
           'Demanda à loja: ' || COALESCE(dl.assunto, dl.tipo_chave,'—'),
           dl.pergunta, dl.created_at,
           'demanda_loja', dl.id, dl.metadata
    FROM demandas_loja dl WHERE dl.contato_cliente_id = _contato_id

    UNION ALL
    SELECT 'demanda', 'demanda_encerrada',
           'Demanda encerrada',
           NULL, dl.encerrada_at,
           'demanda_loja', dl.id, dl.metadata
    FROM demandas_loja dl WHERE dl.contato_cliente_id = _contato_id AND dl.encerrada_at IS NOT NULL
  )
  SELECT u.fonte, u.tipo, u.titulo, u.descricao, u.ocorrido_at,
         u.referencia_tipo, u.referencia_id, u.metadata
  FROM unified u
  WHERE u.ocorrido_at IS NOT NULL
    AND (_filtros IS NULL OR u.fonte = ANY(_filtros))
  ORDER BY u.ocorrido_at DESC
  LIMIT _limit OFFSET _offset
$$;

GRANT EXECUTE ON FUNCTION public.contato_timeline(uuid,int,int,text[]) TO authenticated;

-- KPIs agregados do cliente
CREATE OR REPLACE FUNCTION public.contato_kpis(_contato_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'cashback_saldo', COALESCE((
      SELECT SUM(saldo) FROM cashback_credito
      WHERE contato_id = _contato_id AND status = 'ativo'
    ),0),
    'cashback_total_gerado', COALESCE((
      SELECT SUM(valor_gerado) FROM cashback_credito WHERE contato_id = _contato_id
    ),0),
    'ltv', COALESCE((
      SELECT SUM(valor) FROM pagamentos_link
      WHERE contato_id = _contato_id AND pago_at IS NOT NULL
    ),0) + COALESCE((
      SELECT SUM(valor_total_validado) FROM regua_inscricao WHERE contato_id = _contato_id
    ),0),
    'ultima_interacao', (
      SELECT MAX(ocorrido_at) FROM contato_timeline(_contato_id, 1, 0, NULL)
    ),
    'atendimentos_total', (SELECT COUNT(*) FROM atendimentos WHERE contato_id = _contato_id),
    'agendamentos_total', (SELECT COUNT(*) FROM agendamentos WHERE contato_id = _contato_id),
    'os_total', (SELECT COUNT(*) FROM os_recebimento_loja WHERE contato_id = _contato_id)
  )
$$;

GRANT EXECUTE ON FUNCTION public.contato_kpis(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.contato_timeline(_contato_id uuid, _limit integer DEFAULT 200, _offset integer DEFAULT 0, _filtros text[] DEFAULT NULL::text[])
 RETURNS TABLE(fonte text, tipo text, titulo text, descricao text, ocorrido_at timestamp with time zone, referencia_tipo text, referencia_id uuid, metadata jsonb)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH unified(fonte, tipo, titulo, descricao, ocorrido_at, referencia_tipo, referencia_id, metadata) AS (
    SELECT 'evento_crm'::text, e.tipo::text,
           CASE WHEN e.tipo LIKE 'contato_%' THEN replace(initcap(replace(e.tipo,'_',' ')), 'Contato ', '')
                ELSE initcap(replace(e.tipo,'_',' ')) END,
           e.descricao, e.created_at, e.referencia_tipo, e.referencia_id, e.metadata
    FROM eventos_crm e WHERE e.contato_id = _contato_id

    UNION ALL SELECT 'atendimento','atendimento_iniciado',
           'Atendimento iniciado ('||COALESCE(a.canal::text,'')||')',
           a.atendente_nome, COALESCE(a.inicio_at, a.created_at),'atendimento', a.id, a.metadata
    FROM atendimentos a WHERE a.contato_id=_contato_id

    UNION ALL SELECT 'atendimento','atendimento_encerrado','Atendimento encerrado',
           a.atendente_nome, a.fim_at,'atendimento', a.id, a.metadata
    FROM atendimentos a WHERE a.contato_id=_contato_id AND a.fim_at IS NOT NULL

    UNION ALL SELECT 'agendamento','agendamento_criado',
           'Agendamento em '||COALESCE(ag.loja_nome,'loja')||' para '||to_char(ag.data_horario AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI'),
           ag.observacoes, ag.created_at,'agendamento', ag.id, ag.metadata
    FROM agendamentos ag WHERE ag.contato_id=_contato_id

    UNION ALL SELECT 'agendamento','agendamento_'||ag.status,'Status: '||ag.status,
           ag.observacoes, ag.updated_at,'agendamento', ag.id, ag.metadata
    FROM agendamentos ag WHERE ag.contato_id=_contato_id
      AND ag.status IN ('confirmado','no_show','venda_fechada','cancelado','compareceu')

    UNION ALL SELECT 'cashback','cashback_credito',
           'Cashback gerado: R$ '||to_char(cc.valor_gerado,'FM999G990D00'),
           'Venda '||COALESCE((SELECT numero_venda FROM regua_inscricao WHERE id=cc.inscricao_id),'—'),
           cc.criado_em,'cashback_credito', cc.id,
           jsonb_build_object('saldo',cc.saldo,'expira',cc.data_expiracao,'status',cc.status)
    FROM cashback_credito cc WHERE cc.contato_id=_contato_id

    UNION ALL SELECT 'cashback','cashback_resgate',
           'Cashback usado: R$ '||to_char(cr.valor_usado,'FM999G990D00'),
           'Venda '||COALESCE(cr.numero_venda_uso,'—'),
           cr.data_uso::timestamptz,'cashback_resgate', cr.id,
           jsonb_build_object('credito_id',cr.credito_id)
    FROM cashback_resgate cr WHERE cr.contato_id=_contato_id

    UNION ALL SELECT 'lgpd','optin_pin_confirmado',
           'Opt-in confirmado via PIN (termos '||COALESCE(ri.termos_versao,'?')||')',
           'Venda '||COALESCE(ri.numero_venda,'—')||' · Canal: '||COALESCE(ri.canal_consentimento,'pin_whatsapp'),
           ri.pin_confirmado_at,'regua_inscricao', ri.id,
           jsonb_build_object('venda', ri.numero_venda,'ip', ri.ip_origem_consultor,
             'termos_versao', ri.termos_versao,'canal_consentimento', ri.canal_consentimento,
             'consentimento_status', ri.consentimento_status,
             'evidencia_url', '/termos/cashback?v='||COALESCE(ri.termos_versao,'v2-2026-07'))
    FROM regua_inscricao ri WHERE ri.contato_id=_contato_id AND ri.pin_confirmado_at IS NOT NULL

    UNION ALL SELECT 'lgpd','optin_canal_validado',
           'Canal '||COALESCE(c.tipo::text,'')||' validado (opt-in)',
           'Identificador: '||COALESCE(c.identificador,'—')||
             CASE WHEN c.termos_versao IS NOT NULL THEN ' · Termos '||c.termos_versao ELSE '' END,
           c.validado_at,'canal', c.id,
           jsonb_build_object('tipo', c.tipo::text,'identificador', c.identificador,
             'canal_consentimento', c.canal_consentimento,'termos_versao', c.termos_versao,'status', c.status)
    FROM canais c WHERE c.contato_id=_contato_id AND c.validado_at IS NOT NULL AND c.status='validado'

    UNION ALL SELECT 'lgpd','optout_canal',
           'Opt-out no canal '||COALESCE(c.tipo::text,''),
           'Motivo: '||COALESCE(c.status,'—')||
             CASE WHEN c.ultimo_motivo_falha IS NOT NULL THEN ' · '||c.ultimo_motivo_falha ELSE '' END,
           COALESCE(c.ultima_falha_at, c.validado_at, c.created_at),'canal', c.id,
           jsonb_build_object('tipo', c.tipo::text,'identificador', c.identificador,'status', c.status)
    FROM canais c WHERE c.contato_id=_contato_id AND c.status IN ('optout','pessoa_errada','bloqueado')

    UNION ALL SELECT 'regua','regua_'||rt.tipo,'Régua: '||rt.tipo,
           rt.template_key, COALESCE(rt.enviado_at, rt.data_prevista),'regua_touchpoint', rt.id,
           jsonb_build_object('canal',rt.canal,'status',rt.status,'entrega',rt.status_entrega)
    FROM regua_touchpoint rt JOIN regua_inscricao ri ON ri.id=rt.inscricao_id
    WHERE ri.contato_id=_contato_id

    UNION ALL SELECT 'pagamento','pagamento_criado',
           'Link de pagamento: R$ '||to_char(pl.valor,'FM999G990D00'),
           pl.descricao, pl.created_at,'pagamentos_link', pl.id, pl.metadata
    FROM pagamentos_link pl WHERE pl.contato_id=_contato_id

    UNION ALL SELECT 'pagamento','pagamento_'||COALESCE(pl.status,'?'),
           'Pagamento: '||COALESCE(pl.status,'?'),
           pl.descricao, COALESCE(pl.pago_at, pl.updated_at),'pagamentos_link', pl.id, pl.metadata
    FROM pagamentos_link pl WHERE pl.contato_id=_contato_id AND pl.status IN ('pago','cancelado','expirado')

    UNION ALL SELECT 'os','os_recebida_loja',
           'OS '||COALESCE(orl.os_numero,'—')||' recebida na loja',
           orl.loja_nome, orl.recebido_at,'os_recebimento_loja', orl.id,
           jsonb_build_object('wa_status', orl.wa_status,'produto', orl.produto_descricao)
    FROM os_recebimento_loja orl WHERE orl.contato_id=_contato_id AND orl.recebido_at IS NOT NULL
  )
  SELECT fonte, tipo, titulo, descricao, ocorrido_at, referencia_tipo, referencia_id, metadata
  FROM unified
  WHERE (_filtros IS NULL OR fonte = ANY(_filtros))
  ORDER BY ocorrido_at DESC NULLS LAST
  LIMIT _limit OFFSET _offset;
$function$;
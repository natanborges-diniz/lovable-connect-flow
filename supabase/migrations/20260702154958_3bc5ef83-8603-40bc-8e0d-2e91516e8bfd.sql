
-- 1) Migrar históricos: créditos ainda sem PIN confirmado passam a 'pendente_pin'
UPDATE public.cashback_credito c
   SET status = 'pendente_pin'
  FROM public.regua_inscricao r
 WHERE c.inscricao_id = r.id
   AND c.status = 'ativo'
   AND r.pin_hash IS NOT NULL
   AND r.pin_confirmado_at IS NULL;

-- 2) cashback_registrar_resgate: criar crédito como 'pendente_pin' (só vira 'ativo' após PIN)
CREATE OR REPLACE FUNCTION public.cashback_registrar_resgate(_contato_id uuid, _numero_venda text, _valor_informado numeric, _cashback_usado numeric, _cod_empresa text, _usuario_lancamento uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cfg              record;
  _contato          record;
  _saldo_disponivel numeric := 0;
  _restante         numeric;
  _cred             record;
  _consumo          numeric;
  _resgates         jsonb := '[]'::jsonb;
  _venda_resp       jsonb;
  _inscricao_id     uuid;
  _valor_base       numeric;
  _valor_gerado     numeric;
  _novo_credito_id  uuid;
  _hoje             date := CURRENT_DATE;
  _liberado_em      date;
  _expira_em        date;
  _saldo_total      numeric;
  _whatsapp         text;
  _cpf              text;
  _credito_existente record;
  _ja_resgate_count int;
BEGIN
  IF _contato_id IS NULL THEN RAISE EXCEPTION 'contato_invalido'; END IF;
  IF _numero_venda IS NULL OR length(trim(_numero_venda)) = 0 THEN RAISE EXCEPTION 'numero_venda_invalido'; END IF;
  IF _valor_informado IS NULL OR _valor_informado <= 0 THEN RAISE EXCEPTION 'valor_invalido'; END IF;
  IF _cashback_usado IS NULL OR _cashback_usado < 0 THEN RAISE EXCEPTION 'cashback_usado_invalido'; END IF;

  SELECT percentual, validade_dias, fator_resgate INTO _cfg
    FROM public.cashback_config ORDER BY atualizado_em DESC LIMIT 1;
  IF _cfg IS NULL THEN RAISE EXCEPTION 'cashback_config_ausente'; END IF;

  SELECT id, nome, telefone, documento INTO _contato
    FROM public.contatos WHERE id = _contato_id;
  IF _contato IS NULL THEN RAISE EXCEPTION 'contato_nao_encontrado'; END IF;
  _whatsapp := regexp_replace(COALESCE(_contato.telefone, ''), '\D', '', 'g');
  _cpf      := regexp_replace(COALESCE(_contato.documento, ''), '\D', '', 'g');

  _venda_resp := public.regua_registrar_venda(
    p_nome              => COALESCE(_contato.nome, 'Cliente'),
    p_whatsapp_digits   => _whatsapp,
    p_cpf_digits        => _cpf,
    p_numero_venda      => _numero_venda,
    p_valor             => _valor_informado,
    p_cod_empresa       => _cod_empresa,
    p_usuario_lancamento=> COALESCE(_usuario_lancamento::text, '')
  );
  _inscricao_id := (_venda_resp->>'inscricao_id')::uuid;

  IF _inscricao_id IS NOT NULL THEN
    SELECT id, valor_gerado, liberado_em, data_expiracao
      INTO _credito_existente
      FROM public.cashback_credito
     WHERE inscricao_id = _inscricao_id
     LIMIT 1;
  END IF;

  SELECT COUNT(*) INTO _ja_resgate_count
    FROM public.cashback_resgate
   WHERE numero_venda_uso = _numero_venda;

  IF _credito_existente.id IS NOT NULL OR _ja_resgate_count > 0 THEN
    SELECT COALESCE(SUM(saldo), 0) INTO _saldo_total
      FROM public.cashback_credito
     WHERE contato_id = _contato_id AND status = 'ativo' AND saldo > 0;

    RETURN jsonb_build_object(
      'ja_processado', true,
      'saldo_total_atual', _saldo_total,
      'credito_gerado', CASE WHEN _credito_existente.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', _credito_existente.id,
          'valor', _credito_existente.valor_gerado,
          'liberado_em', _credito_existente.liberado_em,
          'data_expiracao', _credito_existente.data_expiracao
        )
      END,
      'inscricao_id', _inscricao_id,
      'ja_existia_inscricao', COALESCE((_venda_resp->>'ja_existia')::boolean, false)
    );
  END IF;

  IF _cashback_usado > 0 THEN
    SELECT COALESCE(SUM(saldo), 0) INTO _saldo_disponivel
      FROM public.cashback_credito
      WHERE contato_id = _contato_id AND status = 'ativo' AND saldo > 0
        AND COALESCE(liberado_em, data_geracao, _hoje) <= _hoje
        AND (data_expiracao IS NULL OR data_expiracao >= _hoje);

    IF _saldo_disponivel < _cashback_usado THEN
      RAISE EXCEPTION 'saldo_insuficiente: disponivel=% solicitado=%', _saldo_disponivel, _cashback_usado;
    END IF;

    IF _valor_informado < _cashback_usado * _cfg.fator_resgate THEN
      RAISE EXCEPTION 'trava_3x: venda=% precisa ser >= % (cashback % x fator %)',
        _valor_informado, _cashback_usado * _cfg.fator_resgate, _cashback_usado, _cfg.fator_resgate;
    END IF;
  END IF;

  IF _cashback_usado > 0 THEN
    _restante := _cashback_usado;
    FOR _cred IN
      SELECT id, saldo FROM public.cashback_credito
        WHERE contato_id = _contato_id AND status = 'ativo' AND saldo > 0
          AND COALESCE(liberado_em, data_geracao, _hoje) <= _hoje
          AND (data_expiracao IS NULL OR data_expiracao >= _hoje)
        ORDER BY data_expiracao ASC NULLS LAST, criado_em ASC
        FOR UPDATE
    LOOP
      EXIT WHEN _restante <= 0;
      _consumo := LEAST(_cred.saldo, _restante);

      UPDATE public.cashback_credito
         SET saldo  = saldo - _consumo,
             status = CASE WHEN saldo - _consumo <= 0 THEN 'usado' ELSE status END
       WHERE id = _cred.id;

      INSERT INTO public.cashback_resgate (credito_id, contato_id, valor_usado, numero_venda_uso)
        VALUES (_cred.id, _contato_id, _consumo, _numero_venda);

      _resgates := _resgates || jsonb_build_object('credito_id', _cred.id, 'valor_usado', _consumo);
      _restante := _restante - _consumo;
    END LOOP;

    IF _restante > 0 THEN RAISE EXCEPTION 'consumo_incompleto: restante=%', _restante; END IF;
  END IF;

  IF _cashback_usado > 0 AND _inscricao_id IS NOT NULL THEN
    UPDATE public.regua_inscricao
       SET origem = 'RESGATE_CASHBACK'
     WHERE id = _inscricao_id AND COALESCE(origem, '') <> 'RESGATE_CASHBACK';
  END IF;

  _valor_base   := _valor_informado - _cashback_usado;
  _valor_gerado := round(_valor_base * (_cfg.percentual / 100.0), 2);
  _liberado_em  := _hoje + 5;
  _expira_em    := _hoje + _cfg.validade_dias;

  IF _valor_gerado > 0 THEN
    INSERT INTO public.cashback_credito (
      contato_id, inscricao_id, valor_base, valor_gerado, saldo,
      data_geracao, liberado_em, data_expiracao, prorrogado, status
    ) VALUES (
      _contato_id, _inscricao_id, _valor_base, _valor_gerado, _valor_gerado,
      _hoje, _liberado_em, _expira_em, false, 'pendente_pin'
    )
    RETURNING id INTO _novo_credito_id;
  END IF;

  IF _cashback_usado > 0 THEN
    INSERT INTO public.eventos_crm (contato_id, tipo, descricao, referencia_tipo, referencia_id, metadata)
    VALUES (_contato_id, 'cashback_resgate',
      'Resgate de cashback: R$ ' || _cashback_usado::text || ' na venda ' || _numero_venda,
      'regua_inscricao', _inscricao_id,
      jsonb_build_object('numero_venda', _numero_venda, 'cashback_usado', _cashback_usado,
        'valor_venda', _valor_informado, 'resgates', _resgates,
        'cod_empresa', _cod_empresa, 'usuario_lancamento', _usuario_lancamento));
  END IF;

  IF _novo_credito_id IS NOT NULL THEN
    INSERT INTO public.eventos_crm (contato_id, tipo, descricao, referencia_tipo, referencia_id, metadata)
    VALUES (_contato_id, 'cashback_gerado_pendente_pin',
      'Cashback provisório aguardando PIN: R$ ' || _valor_gerado::text,
      'cashback_credito', _novo_credito_id,
      jsonb_build_object('numero_venda', _numero_venda, 'valor_base', _valor_base,
        'valor_gerado', _valor_gerado, 'percentual', _cfg.percentual,
        'liberado_em', _liberado_em, 'data_expiracao', _expira_em, 'inscricao_id', _inscricao_id,
        'status_inicial', 'pendente_pin'));
  END IF;

  SELECT COALESCE(SUM(saldo), 0) INTO _saldo_total
    FROM public.cashback_credito
   WHERE contato_id = _contato_id AND status = 'ativo' AND saldo > 0;

  RETURN jsonb_build_object(
    'saldo_total_atual', _saldo_total,
    'credito_gerado', CASE WHEN _novo_credito_id IS NULL THEN NULL
      ELSE jsonb_build_object('id', _novo_credito_id, 'valor', _valor_gerado,
        'liberado_em', _liberado_em, 'data_expiracao', _expira_em, 'status', 'pendente_pin')
    END,
    'resgate', _resgates,
    'inscricao_id', _inscricao_id,
    'ja_existia_inscricao', COALESCE((_venda_resp->>'ja_existia')::boolean, false)
  );
END;
$function$;

-- 3) Nova RPC: promove créditos pendentes de PIN para ativos (chamada pela EF no confirm_pin)
CREATE OR REPLACE FUNCTION public.cashback_promover_creditos_por_inscricao(_inscricao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _n int;
  _contato_id uuid;
  _credito_id uuid;
  _valor numeric;
  _liberado_em date;
BEGIN
  IF _inscricao_id IS NULL THEN
    RETURN jsonb_build_object('promovidos', 0);
  END IF;

  WITH upd AS (
    UPDATE public.cashback_credito
       SET status = 'ativo'
     WHERE inscricao_id = _inscricao_id
       AND status = 'pendente_pin'
    RETURNING id, contato_id, valor_gerado, liberado_em
  )
  SELECT count(*), max(id), max(contato_id), max(valor_gerado), max(liberado_em)
    INTO _n, _credito_id, _contato_id, _valor, _liberado_em
    FROM upd;

  IF _n > 0 AND _credito_id IS NOT NULL THEN
    INSERT INTO public.eventos_crm (contato_id, tipo, descricao, referencia_tipo, referencia_id, metadata)
    VALUES (_contato_id, 'cashback_ativado_pos_pin',
      'Cashback ativado após confirmação do PIN: R$ ' || _valor::text ||
      ' (libera ' || to_char(_liberado_em, 'DD/MM') || ')',
      'cashback_credito', _credito_id,
      jsonb_build_object('inscricao_id', _inscricao_id, 'valor_gerado', _valor,
        'liberado_em', _liberado_em, 'creditos_promovidos', _n));
  END IF;

  RETURN jsonb_build_object('promovidos', _n);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cashback_promover_creditos_por_inscricao(uuid) TO authenticated, service_role;

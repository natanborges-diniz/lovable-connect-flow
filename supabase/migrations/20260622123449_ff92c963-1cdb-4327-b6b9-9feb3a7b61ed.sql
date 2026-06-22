
-- Auditoria de cashback D+1: colunas de controle + RPCs de aprovação/cancelamento

ALTER TABLE public.regua_inscricao
  ADD COLUMN IF NOT EXISTS tentativas_reconciliacao int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultima_tentativa_at timestamptz,
  ADD COLUMN IF NOT EXISTS demanda_divergencia_id uuid;

-- ── RPC: aprovar divergência (loja ou supervisor escolhe valor) ──────────
CREATE OR REPLACE FUNCTION public.cashback_aprovar_divergencia(
  _inscricao_id uuid,
  _valor_aceito numeric,
  _origem text,
  _motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_insc            public.regua_inscricao%ROWTYPE;
  v_credito         public.cashback_credito%ROWTYPE;
  v_percentual      numeric;
  v_cashback_usado  numeric;
  v_novo_base       numeric;
  v_novo_gerado     numeric;
  v_demanda_id      uuid;
BEGIN
  IF _origem NOT IN ('loja_ajustou_sistema','loja_manteve_lancado','supervisor_override','supervisor_aprovou_sistema','supervisor_aprovou_lancado') THEN
    RAISE EXCEPTION 'origem inválida: %', _origem;
  END IF;

  SELECT * INTO v_insc FROM public.regua_inscricao WHERE id = _inscricao_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'inscrição não encontrada'; END IF;

  SELECT * INTO v_credito FROM public.cashback_credito WHERE inscricao_id = _inscricao_id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'crédito não encontrado'; END IF;

  SELECT COALESCE(SUM(valor_usado),0) INTO v_cashback_usado
  FROM public.cashback_resgate WHERE numero_venda_uso = v_insc.numero_venda;

  SELECT percentual INTO v_percentual FROM public.cashback_config
   ORDER BY atualizado_em DESC NULLS LAST LIMIT 1;
  IF v_percentual IS NULL THEN v_percentual := 0; END IF;

  v_novo_base   := COALESCE(_valor_aceito,0) - COALESCE(v_cashback_usado,0);
  IF v_novo_base < 0 THEN v_novo_base := 0; END IF;
  v_novo_gerado := round(v_novo_base * v_percentual / 100.0, 2);

  UPDATE public.cashback_credito
     SET valor_base = v_novo_base,
         valor_gerado = v_novo_gerado,
         saldo = v_novo_gerado
   WHERE id = v_credito.id;

  UPDATE public.regua_inscricao
     SET valor_total_validado = _valor_aceito,
         valor_status = 'ok'
   WHERE id = _inscricao_id;

  -- Fecha demanda associada (silenciosamente, sem comunicação ao cliente)
  v_demanda_id := v_insc.demanda_divergencia_id;
  IF v_demanda_id IS NOT NULL THEN
    UPDATE public.demandas_loja
       SET status = 'encerrada',
           encerrada_at = COALESCE(encerrada_at, now()),
           metadata = COALESCE(metadata,'{}'::jsonb)
                      || jsonb_build_object(
                           'cashback_decisao', _origem,
                           'cashback_valor_aceito', _valor_aceito,
                           'cashback_decidida_at', now()
                         )
     WHERE id = v_demanda_id;
  END IF;

  -- Evento interno na timeline do cliente. NÃO envia nada ao cliente.
  INSERT INTO public.eventos_crm
    (contato_id, tipo, descricao, referencia_tipo, referencia_id, metadata)
  VALUES (
    v_credito.contato_id,
    'cashback_divergencia_resolvida',
    'Divergência de cashback resolvida (interno, silencioso ao cliente)',
    'cashback_credito',
    v_credito.id,
    jsonb_build_object(
      'inscricao_id', _inscricao_id,
      'numero_venda', v_insc.numero_venda,
      'valor_aceito', _valor_aceito,
      'origem_decisao', _origem,
      'motivo', _motivo
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'valor_aceito', _valor_aceito,
    'valor_gerado', v_novo_gerado,
    'origem', _origem
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashback_aprovar_divergencia(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cashback_aprovar_divergencia(uuid, numeric, text, text) TO service_role;

-- ── RPC: cancelar inscrição (estorna provisório, silencioso) ─────────────
CREATE OR REPLACE FUNCTION public.cashback_cancelar_inscricao(
  _inscricao_id uuid,
  _motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_insc    public.regua_inscricao%ROWTYPE;
  v_credito public.cashback_credito%ROWTYPE;
  v_demanda_id uuid;
BEGIN
  SELECT * INTO v_insc FROM public.regua_inscricao WHERE id = _inscricao_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'inscrição não encontrada'; END IF;

  SELECT * INTO v_credito FROM public.cashback_credito WHERE inscricao_id = _inscricao_id LIMIT 1;

  IF FOUND THEN
    UPDATE public.cashback_credito
       SET status = 'cancelado',
           saldo  = 0,
           valor_gerado = 0
     WHERE id = v_credito.id;
  END IF;

  UPDATE public.regua_inscricao
     SET status = 'cancelada',
         valor_status = COALESCE(valor_status,'cancelado')
   WHERE id = _inscricao_id;

  v_demanda_id := v_insc.demanda_divergencia_id;
  IF v_demanda_id IS NOT NULL THEN
    UPDATE public.demandas_loja
       SET status = 'encerrada',
           encerrada_at = COALESCE(encerrada_at, now()),
           metadata = COALESCE(metadata,'{}'::jsonb)
                      || jsonb_build_object(
                           'cashback_decisao', 'cancelado',
                           'cashback_decidida_at', now(),
                           'motivo', _motivo
                         )
     WHERE id = v_demanda_id;
  END IF;

  IF v_credito.contato_id IS NOT NULL THEN
    INSERT INTO public.eventos_crm
      (contato_id, tipo, descricao, referencia_tipo, referencia_id, metadata)
    VALUES (
      v_credito.contato_id,
      'cashback_cancelado',
      'Crédito de cashback cancelado (interno, silencioso ao cliente)',
      'cashback_credito',
      v_credito.id,
      jsonb_build_object(
        'inscricao_id', _inscricao_id,
        'numero_venda', v_insc.numero_venda,
        'motivo', _motivo
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashback_cancelar_inscricao(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cashback_cancelar_inscricao(uuid, text) TO service_role;

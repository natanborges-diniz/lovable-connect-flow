CREATE OR REPLACE FUNCTION public.cashback_cancelar_inscricao(_inscricao_id uuid, _motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_insc    public.regua_inscricao%ROWTYPE;
  v_credito public.cashback_credito%ROWTYPE;
  v_demanda_id uuid;
  v_tem_resgate boolean;
BEGIN
  SELECT * INTO v_insc FROM public.regua_inscricao WHERE id = _inscricao_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'inscrição não encontrada'; END IF;

  IF v_insc.status = 'cancelada' THEN
    RETURN jsonb_build_object('ok', true, 'ja_cancelada', true);
  END IF;

  SELECT * INTO v_credito FROM public.cashback_credito WHERE inscricao_id = _inscricao_id LIMIT 1;

  IF FOUND THEN
    -- Bloqueia cancelamento se já houve qualquer resgate contra este crédito.
    SELECT EXISTS (
      SELECT 1 FROM public.cashback_resgate cr WHERE cr.credito_id = v_credito.id
    ) INTO v_tem_resgate;

    IF v_tem_resgate THEN
      RAISE EXCEPTION 'Não é possível cancelar: já existe resgate registrado contra este crédito. Use a Auditoria para estorno.'
        USING ERRCODE = 'check_violation';
    END IF;

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

  IF v_insc.contato_id IS NOT NULL THEN
    INSERT INTO public.eventos_crm
      (contato_id, tipo, descricao, referencia_tipo, referencia_id, metadata)
    VALUES (
      v_insc.contato_id,
      'cashback_cancelado',
      'Crédito de cashback cancelado (interno, silencioso ao cliente)',
      'cashback_credito',
      COALESCE(v_credito.id, _inscricao_id),
      jsonb_build_object(
        'inscricao_id', _inscricao_id,
        'numero_venda', v_insc.numero_venda,
        'motivo', _motivo,
        'cancelado_por', auth.uid()
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;
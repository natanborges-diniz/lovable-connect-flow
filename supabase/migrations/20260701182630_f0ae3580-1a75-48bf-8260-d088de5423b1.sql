
CREATE OR REPLACE FUNCTION public.regua_registrar_venda(
  p_nome text, p_whatsapp_digits text, p_cpf_digits text, p_numero_venda text,
  p_valor numeric, p_cod_empresa text, p_usuario_lancamento text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _contato_id uuid;
  _telefone_existente text;
  _documento_existente text;
  _inscricao_existente uuid;
  _inscricao_id uuid;
  _cpf_norm text := NULLIF(regexp_replace(coalesce(p_cpf_digits,''),'\D','','g'),'');
  _tel_norm text := NULLIF(regexp_replace(coalesce(p_whatsapp_digits,''),'\D','','g'),'');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  -- 1) Match por CPF (só se CPF informado E não-vazio)
  IF _cpf_norm IS NOT NULL AND length(_cpf_norm) >= 11 THEN
    SELECT id, telefone, documento INTO _contato_id, _telefone_existente, _documento_existente
    FROM public.contatos
    WHERE regexp_replace(coalesce(documento,''),'\D','','g') = _cpf_norm
    LIMIT 1;
  END IF;

  -- 2) Fallback: match por telefone (evita casar com contatos de documento vazio)
  IF _contato_id IS NULL AND _tel_norm IS NOT NULL THEN
    SELECT id, telefone, documento INTO _contato_id, _telefone_existente, _documento_existente
    FROM public.contatos
    WHERE regexp_replace(coalesce(telefone,''),'\D','','g') = _tel_norm
       OR regexp_replace(coalesce(telefone,''),'\D','','g') = ('55' || _tel_norm)
       OR ('55' || regexp_replace(coalesce(telefone,''),'\D','','g')) = _tel_norm
    ORDER BY criado_em NULLS LAST
    LIMIT 1;
  END IF;

  IF _contato_id IS NULL THEN
    INSERT INTO public.contatos (nome, tipo, documento, telefone)
    VALUES (p_nome, 'cliente'::tipo_contato, _cpf_norm, _tel_norm)
    RETURNING id INTO _contato_id;
  ELSE
    -- Complementa dados vazios sem sobrescrever
    IF (_telefone_existente IS NULL OR length(trim(_telefone_existente)) = 0) AND _tel_norm IS NOT NULL THEN
      UPDATE public.contatos SET telefone = _tel_norm WHERE id = _contato_id;
    END IF;
    IF (_documento_existente IS NULL OR length(trim(_documento_existente)) = 0) AND _cpf_norm IS NOT NULL THEN
      UPDATE public.contatos SET documento = _cpf_norm WHERE id = _contato_id;
    END IF;
  END IF;

  SELECT id INTO _inscricao_existente
  FROM public.regua_inscricao
  WHERE numero_venda = p_numero_venda
  LIMIT 1;

  IF _inscricao_existente IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ja_existia', true,
      'inscricao_id', _inscricao_existente,
      'contato_id', _contato_id
    );
  END IF;

  INSERT INTO public.regua_inscricao (
    contato_id, cpf, nome_cliente, whatsapp, numero_venda,
    valor_total_informado, origem, cod_empresa, usuario_lancamento,
    consentimento_status, status
  ) VALUES (
    _contato_id, _cpf_norm, p_nome, _tel_norm, p_numero_venda,
    p_valor, 'VENDA_LOJA', p_cod_empresa, p_usuario_lancamento,
    'pendente', 'ativa'
  )
  RETURNING id INTO _inscricao_id;

  RETURN jsonb_build_object(
    'ja_existia', false,
    'inscricao_id', _inscricao_id,
    'contato_id', _contato_id
  );
END;
$function$;

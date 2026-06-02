CREATE OR REPLACE FUNCTION public.regua_registrar_venda(
  p_nome text,
  p_whatsapp_digits text,
  p_cpf_digits text,
  p_numero_venda text,
  p_valor numeric,
  p_cod_empresa text,
  p_usuario_lancamento text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _contato_id uuid;
  _telefone_existente text;
  _inscricao_existente uuid;
  _inscricao_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT id, telefone INTO _contato_id, _telefone_existente
  FROM public.contatos
  WHERE regexp_replace(coalesce(documento,''),'\D','','g') = p_cpf_digits
  LIMIT 1;

  IF _contato_id IS NULL THEN
    INSERT INTO public.contatos (nome, tipo, documento, telefone)
    VALUES (p_nome, 'cliente'::tipo_contato, p_cpf_digits, p_whatsapp_digits)
    RETURNING id INTO _contato_id;
  ELSIF _telefone_existente IS NULL OR length(trim(_telefone_existente)) = 0 THEN
    UPDATE public.contatos SET telefone = p_whatsapp_digits WHERE id = _contato_id;
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
    _contato_id, p_cpf_digits, p_nome, p_whatsapp_digits, p_numero_venda,
    p_valor, 'VENDA_LOJA', p_cod_empresa, p_usuario_lancamento,
    'pendente', 'aguardando_entrega'
  ) RETURNING id INTO _inscricao_id;

  RETURN jsonb_build_object(
    'ja_existia', false,
    'inscricao_id', _inscricao_id,
    'contato_id', _contato_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.regua_registrar_venda(text,text,text,text,numeric,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.regua_registrar_venda(text,text,text,text,numeric,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.regua_registrar_venda(text,text,text,text,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regua_registrar_venda(text,text,text,text,numeric,text,text) TO service_role;
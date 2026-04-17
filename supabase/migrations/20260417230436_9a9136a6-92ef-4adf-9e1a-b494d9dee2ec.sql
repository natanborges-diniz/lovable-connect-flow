CREATE OR REPLACE FUNCTION public.sanitize_corporate_contact(_telefone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _setor_corporativo uuid := '32cbd99c-4b20-4c8b-b7b2-901904d0aff6'; -- Atendimento Corporativo
  _contato record;
  _loja record;
  _tipo_contato text;
  _atendimentos_encerrados int := 0;
  _coluna_limpada boolean := false;
  _setor_ajustado boolean := false;
  _tipo_ajustado boolean := false;
  _clean_phone text;
  _coluna_setor uuid;
BEGIN
  _clean_phone := regexp_replace(COALESCE(_telefone, ''), '\D', '', 'g');
  IF length(_clean_phone) = 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'empty_phone');
  END IF;

  SELECT * INTO _loja
  FROM public.telefones_lojas
  WHERE regexp_replace(telefone, '\D', '', 'g') = _clean_phone
    AND ativo = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_corporate');
  END IF;

  _tipo_contato := CASE WHEN _loja.tipo = 'colaborador' THEN 'colaborador' ELSE 'loja' END;

  FOR _contato IN
    SELECT * FROM public.contatos
    WHERE regexp_replace(COALESCE(telefone, ''), '\D', '', 'g') = _clean_phone
  LOOP
    _coluna_limpada := false;
    _setor_ajustado := false;
    _tipo_ajustado := false;
    _atendimentos_encerrados := 0;

    -- (a) Limpa pipeline_coluna_id se NÃO pertence ao setor corporativo
    IF _contato.pipeline_coluna_id IS NOT NULL THEN
      SELECT setor_id INTO _coluna_setor FROM public.pipeline_colunas
      WHERE id = _contato.pipeline_coluna_id;
      IF _coluna_setor IS DISTINCT FROM _setor_corporativo THEN
        UPDATE public.contatos SET pipeline_coluna_id = NULL WHERE id = _contato.id;
        _coluna_limpada := true;
      END IF;
    END IF;

    -- (b) Setor corporativo
    IF _contato.setor_destino IS DISTINCT FROM _setor_corporativo THEN
      UPDATE public.contatos SET setor_destino = _setor_corporativo WHERE id = _contato.id;
      _setor_ajustado := true;
    END IF;

    -- (c) Tipo correto
    IF _contato.tipo::text <> _tipo_contato THEN
      UPDATE public.contatos SET tipo = _tipo_contato::tipo_contato WHERE id = _contato.id;
      _tipo_ajustado := true;
    END IF;

    -- (d) Encerra atendimentos humanos órfãos
    UPDATE public.atendimentos
    SET modo = 'ia',
        status = 'encerrado',
        fim_at = COALESCE(fim_at, now()),
        updated_at = now()
    WHERE contato_id = _contato.id
      AND modo = 'humano'
      AND atendente_nome IS NULL
      AND status <> 'encerrado';
    GET DIAGNOSTICS _atendimentos_encerrados = ROW_COUNT;

    IF _coluna_limpada OR _setor_ajustado OR _tipo_ajustado OR _atendimentos_encerrados > 0 THEN
      INSERT INTO public.eventos_crm (contato_id, tipo, descricao, metadata)
      VALUES (
        _contato.id,
        'reclassificacao_corporativa',
        'Saneamento corporativo: ' ||
          CASE WHEN _coluna_limpada THEN '[coluna não-corp removida] ' ELSE '' END ||
          CASE WHEN _setor_ajustado THEN '[setor corporativo] ' ELSE '' END ||
          CASE WHEN _tipo_ajustado THEN '[tipo=' || _tipo_contato || '] ' ELSE '' END ||
          CASE WHEN _atendimentos_encerrados > 0 THEN '[' || _atendimentos_encerrados || ' humanos órfãos encerrados]' ELSE '' END,
        jsonb_build_object(
          'loja_nome', _loja.nome_loja,
          'tipo_loja', _loja.tipo,
          'coluna_limpada', _coluna_limpada,
          'setor_ajustado', _setor_ajustado,
          'tipo_ajustado', _tipo_ajustado,
          'atendimentos_encerrados', _atendimentos_encerrados
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'telefone', _clean_phone);
END;
$$;

-- Re-executa em lote
DO $$
DECLARE
  _t record;
BEGIN
  FOR _t IN SELECT DISTINCT telefone FROM public.telefones_lojas WHERE ativo = true LOOP
    PERFORM public.sanitize_corporate_contact(_t.telefone);
  END LOOP;
END $$;
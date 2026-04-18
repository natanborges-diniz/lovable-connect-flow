-- 1) Adiciona coluna setor_destino_id em telefones_lojas
ALTER TABLE public.telefones_lojas
  ADD COLUMN IF NOT EXISTS setor_destino_id uuid REFERENCES public.setores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_telefones_lojas_setor_destino
  ON public.telefones_lojas(setor_destino_id);

-- 2) Atualiza sanitize_corporate_contact para respeitar setor_destino_id do cadastro
CREATE OR REPLACE FUNCTION public.sanitize_corporate_contact(_telefone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _setor_corporativo_default uuid := '32cbd99c-4b20-4c8b-b7b2-901904d0aff6'; -- Atendimento Corporativo (fallback)
  _setor_alvo uuid;
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

  -- Setor alvo: usa setor_destino_id do cadastro se houver, senão Atendimento Corporativo
  _setor_alvo := COALESCE(_loja.setor_destino_id, _setor_corporativo_default);

  _tipo_contato := CASE WHEN _loja.tipo = 'colaborador' THEN 'colaborador' ELSE 'loja' END;

  FOR _contato IN
    SELECT * FROM public.contatos
    WHERE regexp_replace(COALESCE(telefone, ''), '\D', '', 'g') = _clean_phone
  LOOP
    _coluna_limpada := false;
    _setor_ajustado := false;
    _tipo_ajustado := false;
    _atendimentos_encerrados := 0;

    -- (a) Limpa pipeline_coluna_id se NÃO pertence ao setor alvo
    IF _contato.pipeline_coluna_id IS NOT NULL THEN
      SELECT setor_id INTO _coluna_setor FROM public.pipeline_colunas
      WHERE id = _contato.pipeline_coluna_id;
      IF _coluna_setor IS DISTINCT FROM _setor_alvo THEN
        UPDATE public.contatos SET pipeline_coluna_id = NULL WHERE id = _contato.id;
        _coluna_limpada := true;
      END IF;
    END IF;

    -- (b) Setor de destino conforme cadastro
    IF _contato.setor_destino IS DISTINCT FROM _setor_alvo THEN
      UPDATE public.contatos SET setor_destino = _setor_alvo WHERE id = _contato.id;
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
          CASE WHEN _coluna_limpada THEN '[coluna não pertence ao setor alvo removida] ' ELSE '' END ||
          CASE WHEN _setor_ajustado THEN '[setor=' || _setor_alvo::text || '] ' ELSE '' END ||
          CASE WHEN _tipo_ajustado THEN '[tipo=' || _tipo_contato || '] ' ELSE '' END ||
          CASE WHEN _atendimentos_encerrados > 0 THEN '[' || _atendimentos_encerrados || ' humanos órfãos encerrados]' ELSE '' END,
        jsonb_build_object(
          'loja_nome', _loja.nome_loja,
          'tipo_loja', _loja.tipo,
          'setor_alvo', _setor_alvo,
          'setor_destino_id_cadastro', _loja.setor_destino_id,
          'coluna_limpada', _coluna_limpada,
          'setor_ajustado', _setor_ajustado,
          'tipo_ajustado', _tipo_ajustado,
          'atendimentos_encerrados', _atendimentos_encerrados
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'telefone', _clean_phone, 'setor_alvo', _setor_alvo);
END;
$function$;

-- 3) Garante que trigger dispara também quando setor_destino_id muda
CREATE OR REPLACE FUNCTION public.on_telefone_loja_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND COALESCE(NEW.ativo, true) = true)
     OR (TG_OP = 'UPDATE' AND (
          (COALESCE(OLD.ativo, true) = false AND COALESCE(NEW.ativo, true) = true)
          OR OLD.telefone IS DISTINCT FROM NEW.telefone
          OR OLD.tipo IS DISTINCT FROM NEW.tipo
          OR OLD.setor_destino_id IS DISTINCT FROM NEW.setor_destino_id
        ))
  THEN
    PERFORM public.sanitize_corporate_contact(NEW.telefone);
  END IF;
  RETURN NEW;
END;
$function$;
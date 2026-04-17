-- 1. Função reutilizável de saneamento corporativo
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
BEGIN
  _clean_phone := regexp_replace(COALESCE(_telefone, ''), '\D', '', 'g');
  IF length(_clean_phone) = 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'empty_phone');
  END IF;

  -- Busca match em telefones_lojas
  SELECT * INTO _loja
  FROM public.telefones_lojas
  WHERE regexp_replace(telefone, '\D', '', 'g') = _clean_phone
    AND ativo = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_corporate');
  END IF;

  _tipo_contato := CASE WHEN _loja.tipo = 'colaborador' THEN 'colaborador' ELSE 'loja' END;

  -- Loop em todos os contatos com esse telefone (em geral 1, mas defensivo)
  FOR _contato IN
    SELECT * FROM public.contatos
    WHERE regexp_replace(COALESCE(telefone, ''), '\D', '', 'g') = _clean_phone
  LOOP
    -- (a) Limpa pipeline_coluna_id se aponta para coluna do CRM Vendas (setor_id IS NULL)
    IF _contato.pipeline_coluna_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.pipeline_colunas
        WHERE id = _contato.pipeline_coluna_id AND setor_id IS NULL
      ) THEN
        UPDATE public.contatos SET pipeline_coluna_id = NULL WHERE id = _contato.id;
        _coluna_limpada := true;
      END IF;
    END IF;

    -- (b) Define setor_destino corporativo se vazio ou apontando pra setor não-corporativo
    IF _contato.setor_destino IS DISTINCT FROM _setor_corporativo THEN
      UPDATE public.contatos SET setor_destino = _setor_corporativo WHERE id = _contato.id;
      _setor_ajustado := true;
    END IF;

    -- (c) Garante tipo correto
    IF _contato.tipo::text <> _tipo_contato THEN
      UPDATE public.contatos SET tipo = _tipo_contato::tipo_contato WHERE id = _contato.id;
      _tipo_ajustado := true;
    END IF;

    -- (d) Encerra atendimentos abertos em modo='humano' SEM atendente_nome (órfãos)
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

    -- Loga evento
    IF _coluna_limpada OR _setor_ajustado OR _tipo_ajustado OR _atendimentos_encerrados > 0 THEN
      INSERT INTO public.eventos_crm (contato_id, tipo, descricao, metadata)
      VALUES (
        _contato.id,
        'reclassificacao_corporativa',
        'Saneamento corporativo automático: ' ||
          CASE WHEN _coluna_limpada THEN '[CRM removido] ' ELSE '' END ||
          CASE WHEN _setor_ajustado THEN '[setor corporativo] ' ELSE '' END ||
          CASE WHEN _tipo_ajustado THEN '[tipo=' || _tipo_contato || '] ' ELSE '' END ||
          CASE WHEN _atendimentos_encerrados > 0 THEN '[' || _atendimentos_encerrados || ' atend. humanos órfãos encerrados]' ELSE '' END,
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

  RETURN jsonb_build_object(
    'success', true,
    'telefone', _clean_phone,
    'coluna_limpada', _coluna_limpada,
    'setor_ajustado', _setor_ajustado,
    'tipo_ajustado', _tipo_ajustado,
    'atendimentos_encerrados', _atendimentos_encerrados
  );
END;
$$;

-- 2. Trigger em telefones_lojas: saneia automaticamente ao cadastrar/ativar
CREATE OR REPLACE FUNCTION public.on_telefone_loja_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Só dispara quando ativo (insert ativo, ou update que torna ativo, ou troca telefone)
  IF (TG_OP = 'INSERT' AND COALESCE(NEW.ativo, true) = true)
     OR (TG_OP = 'UPDATE' AND (
          (COALESCE(OLD.ativo, true) = false AND COALESCE(NEW.ativo, true) = true)
          OR OLD.telefone IS DISTINCT FROM NEW.telefone
          OR OLD.tipo IS DISTINCT FROM NEW.tipo
        ))
  THEN
    PERFORM public.sanitize_corporate_contact(NEW.telefone);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_telefone_loja_change ON public.telefones_lojas;
CREATE TRIGGER trg_on_telefone_loja_change
AFTER INSERT OR UPDATE ON public.telefones_lojas
FOR EACH ROW EXECUTE FUNCTION public.on_telefone_loja_change();

-- 3. Saneamento one-shot: roda para todos os corporativos hoje
DO $$
DECLARE
  _t record;
  _result jsonb;
  _total int := 0;
BEGIN
  FOR _t IN
    SELECT DISTINCT telefone FROM public.telefones_lojas WHERE ativo = true
  LOOP
    _result := public.sanitize_corporate_contact(_t.telefone);
    IF (_result->>'success')::boolean THEN
      _total := _total + 1;
    END IF;
  END LOOP;
  RAISE LOG '[SANEAMENTO_CORPORATIVO_LOTE] processados: %', _total;
END $$;

-- 1) Função simétrica: reverte contato quando deixa de ser corporativo
CREATE OR REPLACE FUNCTION public.desanitize_corporate_contact(_telefone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _clean_phone text;
  _contato record;
  _ainda_corporativo boolean;
  _atendimentos_resetados int := 0;
  _coluna_setor uuid;
  _setor_corporativo uuid := '32cbd99c-4b20-4c8b-b7b2-901904d0aff6';
BEGIN
  _clean_phone := regexp_replace(COALESCE(_telefone, ''), '\D', '', 'g');
  IF length(_clean_phone) = 0 THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'empty_phone');
  END IF;

  -- Se ainda existir outro cadastro ativo com mesmo telefone, não reverte
  SELECT EXISTS (
    SELECT 1 FROM public.telefones_lojas
    WHERE regexp_replace(telefone, '\D', '', 'g') = _clean_phone
      AND ativo = true
  ) INTO _ainda_corporativo;

  IF _ainda_corporativo THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'still_corporate');
  END IF;

  FOR _contato IN
    SELECT * FROM public.contatos
    WHERE regexp_replace(COALESCE(telefone, ''), '\D', '', 'g') = _clean_phone
  LOOP
    -- Reset tipo, setor e coluna se vinculados ao setor corporativo
    UPDATE public.contatos
    SET tipo = 'cliente'::tipo_contato,
        setor_destino = NULL,
        pipeline_coluna_id = CASE
          WHEN pipeline_coluna_id IS NULL THEN NULL
          ELSE (
            SELECT CASE
              WHEN pc.setor_id = _setor_corporativo THEN NULL
              ELSE _contato.pipeline_coluna_id
            END
            FROM public.pipeline_colunas pc WHERE pc.id = _contato.pipeline_coluna_id
          )
        END
    WHERE id = _contato.id;

    -- Desativa ponte
    UPDATE public.contato_ponte SET ativo = false, updated_at = now()
    WHERE contato_id = _contato.id AND ativo = true;

    -- Atendimentos abertos em modo ponte ou humano órfão -> volta para IA
    UPDATE public.atendimentos
    SET modo = 'ia',
        status = CASE WHEN status = 'encerrado' THEN status ELSE 'aguardando'::status_atendimento END,
        updated_at = now()
    WHERE contato_id = _contato.id
      AND status <> 'encerrado'
      AND (modo = 'ponte' OR (modo = 'humano' AND atendente_nome IS NULL));
    GET DIAGNOSTICS _atendimentos_resetados = ROW_COUNT;

    INSERT INTO public.eventos_crm (contato_id, tipo, descricao, metadata)
    VALUES (
      _contato.id,
      'desclassificacao_corporativa',
      'Telefone removido de Telefones Corporativos — contato volta a ser cliente normal' ||
        CASE WHEN _atendimentos_resetados > 0 THEN ' [' || _atendimentos_resetados || ' atendimento(s) resetado(s) para IA]' ELSE '' END,
      jsonb_build_object('telefone', _clean_phone, 'atendimentos_resetados', _atendimentos_resetados)
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'telefone', _clean_phone);
END;
$$;

-- 2) Estende o trigger on_telefone_loja_change para chamar desanitize na desativação/deleção
CREATE OR REPLACE FUNCTION public.on_telefone_loja_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Caminho de ATIVAÇÃO / criação / mudança que mantém ativo: saneia para corporativo
  IF (TG_OP = 'INSERT' AND COALESCE(NEW.ativo, true) = true)
     OR (TG_OP = 'UPDATE' AND (
          (COALESCE(OLD.ativo, true) = false AND COALESCE(NEW.ativo, true) = true)
          OR (COALESCE(NEW.ativo, true) = true AND (
               OLD.telefone IS DISTINCT FROM NEW.telefone
            OR OLD.tipo IS DISTINCT FROM NEW.tipo
            OR OLD.setor_destino_id IS DISTINCT FROM NEW.setor_destino_id
          ))
        ))
  THEN
    PERFORM public.sanitize_corporate_contact(NEW.telefone);
  END IF;

  -- Caminho de DESATIVAÇÃO: reverte contato para cliente
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.ativo, true) = true
     AND COALESCE(NEW.ativo, true) = false
  THEN
    PERFORM public.desanitize_corporate_contact(NEW.telefone);
  END IF;

  -- Caminho de DELEÇÃO: também reverte
  IF TG_OP = 'DELETE' AND COALESCE(OLD.ativo, true) = true THEN
    PERFORM public.desanitize_corporate_contact(OLD.telefone);
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- Garante que trigger cobre DELETE também
DROP TRIGGER IF EXISTS trg_on_telefone_loja_change ON public.telefones_lojas;
CREATE TRIGGER trg_on_telefone_loja_change
AFTER INSERT OR UPDATE OR DELETE ON public.telefones_lojas
FOR EACH ROW EXECUTE FUNCTION public.on_telefone_loja_change();

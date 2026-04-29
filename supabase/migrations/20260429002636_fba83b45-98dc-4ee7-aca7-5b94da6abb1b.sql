-- Índice GIN para queries em metadata (lojas_ids do modo grupo)
CREATE INDEX IF NOT EXISTS idx_demandas_loja_metadata_gin
  ON public.demandas_loja USING GIN (metadata);

-- Função de push para demanda nova (loja única ou grupo)
CREATE OR REPLACE FUNCTION public.trg_push_demanda_loja_nova_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ids uuid[] := '{}';
  _loja_nomes text[];
  _ln text;
  _add uuid[];
  _preview text;
BEGIN
  -- Modo grupo: pega lista de lojas de metadata.lojas_nomes
  IF COALESCE(NEW.metadata->>'grupo','false') = 'true' THEN
    SELECT ARRAY(SELECT jsonb_array_elements_text(NEW.metadata->'lojas_nomes'))
      INTO _loja_nomes;
  ELSE
    _loja_nomes := ARRAY[NEW.loja_nome];
  END IF;

  IF _loja_nomes IS NULL THEN RETURN NEW; END IF;

  FOREACH _ln IN ARRAY _loja_nomes LOOP
    SELECT ARRAY(SELECT user_id FROM public.resolver_destinatarios_loja(_ln))
      INTO _add;
    IF _add IS NOT NULL THEN
      _ids := _ids || _add;
    END IF;
  END LOOP;

  -- Dedup
  SELECT ARRAY(SELECT DISTINCT u FROM unnest(_ids) AS u) INTO _ids;
  IF array_length(_ids,1) IS NULL THEN RETURN NEW; END IF;

  _preview := left(coalesce(NEW.assunto, NEW.pergunta, 'Nova demanda'), 100);

  PERFORM public.fn_send_push(
    _ids,
    'Nova demanda' || coalesce(' #' || NEW.protocolo, ''),
    _preview,
    '/demandas?demanda=' || NEW.id::text,
    'demanda_nova_' || NEW.id::text
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_push_demanda_loja_nova ON public.demandas_loja;
CREATE TRIGGER trg_push_demanda_loja_nova
  AFTER INSERT ON public.demandas_loja
  FOR EACH ROW EXECUTE FUNCTION public.trg_push_demanda_loja_nova_fn();
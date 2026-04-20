CREATE INDEX IF NOT EXISTS idx_mensagens_internas_conversa_id
  ON public.mensagens_internas(conversa_id);

CREATE OR REPLACE FUNCTION public.on_mensagem_interna_demanda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _supabase_url text;
  _service_key text;
BEGIN
  IF NEW.conversa_id NOT LIKE 'demanda_%' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO _supabase_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT decrypted_secret INTO _service_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    _supabase_url := NULL; _service_key := NULL;
  END;

  IF _supabase_url IS NULL OR _service_key IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := _supabase_url || '/functions/v1/bridge-demanda',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _service_key
    ),
    body := jsonb_build_object(
      'mensagem_interna_id', NEW.id,
      'conversa_id', NEW.conversa_id,
      'remetente_id', NEW.remetente_id,
      'destinatario_id', NEW.destinatario_id,
      'conteudo', NEW.conteudo,
      'anexo_url', NEW.anexo_url,
      'anexo_tipo', NEW.anexo_tipo
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mensagem_interna_demanda ON public.mensagens_internas;
CREATE TRIGGER trg_mensagem_interna_demanda
  AFTER INSERT ON public.mensagens_internas
  FOR EACH ROW
  EXECUTE FUNCTION public.on_mensagem_interna_demanda();
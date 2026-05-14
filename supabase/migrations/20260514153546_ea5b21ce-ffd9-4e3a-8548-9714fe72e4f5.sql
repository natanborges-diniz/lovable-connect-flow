CREATE OR REPLACE FUNCTION public.on_agendamento_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _supabase_url text;
  _service_key text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO _supabase_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT decrypted_secret INTO _service_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    _supabase_url := NULL; _service_key := NULL;
  END;

  IF _supabase_url IS NULL THEN
    BEGIN _supabase_url := current_setting('supabase.url', true); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF _service_key IS NULL THEN
    BEGIN _service_key := current_setting('supabase.service_role_key', true); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  IF _supabase_url IS NOT NULL AND _service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := _supabase_url || '/functions/v1/pipeline-automations',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _service_key
      ),
      body := jsonb_build_object(
        'entity_type', 'agendamento',
        'entity_id', NEW.id,
        'status_novo', NEW.status,
        'status_anterior', NULL
      )
    );
    RAISE LOG '[TRIGGER INSERT] agendamento % status inicial: %', NEW.id, NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_agendamento_insert_pipeline ON public.agendamentos;
CREATE TRIGGER trg_agendamento_insert_pipeline
  AFTER INSERT ON public.agendamentos
  FOR EACH ROW EXECUTE FUNCTION public.on_agendamento_inserted();
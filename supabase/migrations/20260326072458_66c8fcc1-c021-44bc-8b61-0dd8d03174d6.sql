CREATE OR REPLACE FUNCTION on_agendamento_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _supabase_url text;
  _service_key text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Try vault first
    BEGIN
      SELECT decrypted_secret INTO _supabase_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
      SELECT decrypted_secret INTO _service_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      _supabase_url := NULL;
      _service_key := NULL;
    END;

    -- Fallback: try current_setting (Supabase exposes these internally)
    IF _supabase_url IS NULL THEN
      BEGIN
        _supabase_url := current_setting('supabase.url', true);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    IF _service_key IS NULL THEN
      BEGIN
        _service_key := current_setting('supabase.service_role_key', true);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
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
          'status_anterior', OLD.status
        )
      );
      RAISE LOG '[TRIGGER] agendamento % status: % -> %', NEW.id, OLD.status, NEW.status;
    ELSE
      RAISE LOG '[TRIGGER] Missing secrets - url found: %, key found: %', (_supabase_url IS NOT NULL), (_service_key IS NOT NULL);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
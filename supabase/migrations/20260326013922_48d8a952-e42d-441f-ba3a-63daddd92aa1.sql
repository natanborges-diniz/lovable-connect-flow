
-- Fix trigger functions to use correct pg_net syntax
CREATE OR REPLACE FUNCTION public.on_agendamento_status_change()
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
    SELECT decrypted_secret INTO _supabase_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT decrypted_secret INTO _service_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;
    
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
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_contato_coluna_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _supabase_url text;
  _service_key text;
BEGIN
  IF OLD.pipeline_coluna_id IS DISTINCT FROM NEW.pipeline_coluna_id AND NEW.pipeline_coluna_id IS NOT NULL THEN
    SELECT decrypted_secret INTO _supabase_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT decrypted_secret INTO _service_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;
    
    IF _supabase_url IS NOT NULL AND _service_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := _supabase_url || '/functions/v1/pipeline-automations',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || _service_key
        ),
        body := jsonb_build_object(
          'entity_type', 'contato',
          'entity_id', NEW.id,
          'coluna_id', NEW.pipeline_coluna_id,
          'coluna_anterior_id', OLD.pipeline_coluna_id
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

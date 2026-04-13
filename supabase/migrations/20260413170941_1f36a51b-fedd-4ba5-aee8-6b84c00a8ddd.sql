
-- Helper functions for pg_cron management (called by manage-cron-jobs edge function via service_role)
CREATE OR REPLACE FUNCTION public.schedule_cron_job(job_name text, cron_expression text, sql_command text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'extensions'
AS $$
DECLARE
  _job_id bigint;
BEGIN
  SELECT cron.schedule(job_name, cron_expression, sql_command) INTO _job_id;
  RETURN _job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unschedule_cron_job(job_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'extensions'
AS $$
BEGIN
  PERFORM cron.unschedule(job_name);
END;
$$;

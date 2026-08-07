-- 1. Registro central das tarefas agendadas
CREATE TABLE IF NOT EXISTS public.cron_registry (
  jobname text PRIMARY KEY,
  schedule text NOT NULL,
  fn text NOT NULL,
  body jsonb NOT NULL DEFAULT '{"trigger":"cron"}'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cron_registry TO authenticated;
GRANT ALL ON public.cron_registry TO service_role;
ALTER TABLE public.cron_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cron_registry_admin_read" ON public.cron_registry;
CREATE POLICY "cron_registry_admin_read" ON public.cron_registry
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS trg_cron_registry_updated ON public.cron_registry;
CREATE TRIGGER trg_cron_registry_updated BEFORE UPDATE ON public.cron_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Log de saúde / autocorreção
CREATE TABLE IF NOT EXISTS public.cron_saude_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jobname text NOT NULL,
  acao text NOT NULL,
  motivo text,
  detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cron_saude_log_created ON public.cron_saude_log (created_at DESC);
GRANT SELECT ON public.cron_saude_log TO authenticated;
GRANT ALL ON public.cron_saude_log TO service_role;
ALTER TABLE public.cron_saude_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cron_saude_log_admin_read" ON public.cron_saude_log;
CREATE POLICY "cron_saude_log_admin_read" ON public.cron_saude_log
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- 3. Chamada de edge function SEM token rotacionável
CREATE OR REPLACE FUNCTION public.chamar_edge_function(fn text, body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions','net'
AS $$
DECLARE
  _url text;
  _req bigint;
BEGIN
  SELECT value INTO _url FROM public.app_config WHERE key = 'SUPABASE_URL' LIMIT 1;
  IF _url IS NULL THEN _url := 'https://kvggebtnqmxydtwaumqz.supabase.co'; END IF;

  SELECT net.http_post(
    url := rtrim(_url,'/') || '/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-Internal-Caller','pg_cron'
    ),
    body := coalesce(body,'{}'::jsonb)
  ) INTO _req;

  RETURN _req;
END;
$$;
REVOKE ALL ON FUNCTION public.chamar_edge_function(text, jsonb) FROM public, anon, authenticated;

-- 4. Popula o registro com os jobs atuais
INSERT INTO public.cron_registry (jobname, schedule, fn, body) VALUES
  ('agendamentos-cron-15min',              '*/15 * * * *', 'agendamentos-cron',                 '{"trigger":"cron"}'),
  ('vendas-recuperacao-hourly',            '0 * * * *',    'vendas-recuperacao-cron',           '{"trigger":"cron"}'),
  ('agendamentos-cron-5min',               '*/5 * * * *',  'agendamentos-cron',                 '{"trigger":"cron"}'),
  ('vendas-recuperacao-15min',             '*/15 * * * *', 'vendas-recuperacao-cron',           '{"trigger":"cron"}'),
  ('watchdog-loop-ia-every-2min',          '*/2 * * * *',  'watchdog-loop-ia',                  '{"trigger":"cron"}'),
  ('auto-encerrar-demandas',               '*/5 * * * *',  'auto-encerrar-demandas',            '{"trigger":"cron"}'),
  ('watchdog-cancelamento-orfao-15min',    '*/15 * * * *', 'watchdog-cancelamento-orfao',       '{"trigger":"cron"}'),
  ('watchdog-confirmacao-estoque',         '* * * * *',    'watchdog-confirmacao-estoque',      '{"trigger":"cron"}'),
  ('watchdog-demandas-loja',               '* * * * *',    'watchdog-demandas-loja',            '{"trigger":"cron"}'),
  ('regua-reconciliacao-diaria-07h-sp',    '0 10 * * *',   'regua-reconciliacao',               '{"trigger":"cron_07h_sp"}'),
  ('cron-reabertura-fora-horario-10min',   '*/10 * * * *', 'cron-reabertura-fora-horario',      '{"trigger":"cron"}'),
  ('regua-ingestao-diaria-0730-sp',        '30 10 * * *',  'regua-ingestao',                    '{"trigger":"cron_0730_sp"}'),
  ('audit-ia-auto-rodar-seg-08h',          '0 8 * * 1',    'audit-ia-auto',                     '{"fase":"rodar","janela_horas":168,"severidade_minima":"warn","amostra_limpos_pct":10}'),
  ('audit-ia-auto-aplicar-seg-09h',        '0 9 * * 1',    'audit-ia-auto',                     '{"fase":"aplicar"}'),
  ('watchdog-inbound-orfao-1min',          '* * * * *',    'watchdog-inbound-orfao',            '{"trigger":"cron"}'),
  ('auto-arquivar-cards-diario',           '30 6 * * *',   'auto-arquivar-cards',               '{"trigger":"cron"}'),
  ('regua-disparo-aguardando-armacao-10h', '0 10 * * *',   'regua-disparo-aguardando-armacao',  '{"trigger":"cron"}')
ON CONFLICT (jobname) DO UPDATE
  SET schedule = EXCLUDED.schedule, fn = EXCLUDED.fn, body = EXCLUDED.body, ativo = true;

-- 5. Autocorreção: reescreve qualquer job divergente / ausente / inativo
CREATE OR REPLACE FUNCTION public.reparar_crons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions','cron','net'
AS $$
DECLARE
  r record;
  _cmd text;
  _atual record;
  _consertados int := 0;
  _ok int := 0;
  _motivo text;
  _lista text[] := ARRAY[]::text[];
BEGIN
  FOR r IN SELECT * FROM public.cron_registry WHERE ativo LOOP
    _cmd := format('select public.chamar_edge_function(%L, %L::jsonb);', r.fn, r.body::text);

    SELECT jobid, command, active, schedule INTO _atual
    FROM cron.job WHERE jobname = r.jobname LIMIT 1;

    _motivo := NULL;
    IF _atual IS NULL THEN
      _motivo := 'ausente';
    ELSIF NOT _atual.active THEN
      _motivo := 'inativo';
    ELSIF btrim(_atual.command) IS DISTINCT FROM _cmd THEN
      _motivo := CASE
        WHEN _atual.command ILIKE '%eyJ%' OR _atual.command ILIKE '%sb_secret%' OR _atual.command ILIKE '%sb_publishable%'
        THEN 'chave_literal' ELSE 'comando_divergente' END;
    ELSIF _atual.schedule IS DISTINCT FROM r.schedule THEN
      _motivo := 'schedule_divergente';
    END IF;

    IF _motivo IS NULL THEN
      _ok := _ok + 1;
    ELSE
      PERFORM cron.schedule(r.jobname, r.schedule, _cmd);
      _consertados := _consertados + 1;
      _lista := _lista || r.jobname;
      INSERT INTO public.cron_saude_log (jobname, acao, motivo, detalhe)
      VALUES (r.jobname, 'reagendado', _motivo,
              jsonb_build_object('fn', r.fn, 'schedule', r.schedule));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', _ok, 'consertados', _consertados, 'jobs', to_jsonb(_lista), 'em', now());
END;
$$;
REVOKE ALL ON FUNCTION public.reparar_crons() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reparar_crons() TO authenticated, service_role;

-- 6. Remove jobs duplicados com nomes gerados e aplica o registro
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE jobname LIKE 'cron\_%' LOOP
    PERFORM cron.unschedule(j.jobname);
  END LOOP;
END $$;

SELECT public.reparar_crons();

-- 7. Supervisor: roda dentro do banco, sem HTTP e sem chave
SELECT cron.schedule('reparar-crons-15min', '*/15 * * * *', 'select public.reparar_crons();');

-- 8. Push deixa de depender da chave rotacionável
CREATE OR REPLACE FUNCTION public.fn_send_push(_user_ids uuid[], _title text, _body text, _url text DEFAULT '/'::text, _tag text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
BEGIN
  IF _user_ids IS NULL OR array_length(_user_ids, 1) IS NULL THEN RETURN; END IF;

  PERFORM public.chamar_edge_function('send-push', jsonb_build_object(
    'user_ids', to_jsonb(_user_ids),
    'title', _title,
    'body', _body,
    'url', _url,
    'tag', _tag
  ));
END;
$$;
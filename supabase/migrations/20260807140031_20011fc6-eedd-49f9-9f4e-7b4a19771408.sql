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
  _ja_alertou boolean;
  _admin uuid;
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

  -- Alerta aos admins (no máximo 1 por hora), já com push via trigger de notificações
  IF _consertados > 0 THEN
    SELECT EXISTS (
      SELECT 1 FROM public.cron_saude_log
      WHERE acao = 'alerta_admin' AND created_at > now() - interval '1 hour'
    ) INTO _ja_alertou;

    IF NOT _ja_alertou THEN
      FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
        INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo)
        VALUES (
          _admin,
          'Tarefas automáticas reparadas',
          format('%s tarefa(s) agendada(s) estavam quebradas e foram corrigidas automaticamente: %s',
                 _consertados, array_to_string(_lista, ', ')),
          'sistema'
        );
      END LOOP;
      INSERT INTO public.cron_saude_log (jobname, acao, motivo, detalhe)
      VALUES ('*', 'alerta_admin', 'autocorrecao', jsonb_build_object('jobs', to_jsonb(_lista)));
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', _ok, 'consertados', _consertados, 'jobs', to_jsonb(_lista), 'em', now());
END;
$$;
REVOKE ALL ON FUNCTION public.reparar_crons() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reparar_crons() TO authenticated, service_role;

-- Saúde dos crons para o painel
CREATE OR REPLACE FUNCTION public.crons_saude()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','extensions','cron'
AS $$
  SELECT jsonb_build_object(
    'jobs', coalesce(jsonb_agg(x ORDER BY x->>'jobname'), '[]'::jsonb),
    'consertos_24h', (SELECT count(*) FROM public.cron_saude_log WHERE acao = 'reagendado' AND created_at > now() - interval '24 hours')
  )
  FROM (
    SELECT jsonb_build_object(
      'jobname', r.jobname,
      'fn', r.fn,
      'schedule', r.schedule,
      'agendado', (j.jobid IS NOT NULL AND j.active),
      'chave_literal', coalesce(j.command ILIKE '%eyJ%' OR j.command ILIKE '%sb_secret%', false),
      'ultima_execucao', d.start_time,
      'ultimo_status', d.status,
      'ultimo_conserto', (SELECT max(created_at) FROM public.cron_saude_log l WHERE l.jobname = r.jobname AND l.acao = 'reagendado')
    ) AS x
    FROM public.cron_registry r
    LEFT JOIN cron.job j ON j.jobname = r.jobname
    LEFT JOIN LATERAL (
      SELECT start_time, status FROM cron.job_run_details rd
      WHERE rd.jobid = j.jobid ORDER BY start_time DESC LIMIT 1
    ) d ON true
    WHERE r.ativo
  ) s;
$$;
REVOKE ALL ON FUNCTION public.crons_saude() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crons_saude() TO authenticated, service_role;
-- ═══════════════════════════════════════════════════════════════════════════
-- Consultoria Gael — Jul/2026
-- APRENDIZADO AUTOMÁTICO SEMANAL (zero cliques)
--
-- Agenda duas execuções toda segunda-feira:
--   05:00 SP (08:00 UTC) → audit-ia-auto {fase:"rodar"}   — audita a semana
--   06:00 SP (09:00 UTC) → audit-ia-auto {fase:"aplicar"} — consolida, aplica
--     correções seguras, recompila o prompt e notifica os responsáveis.
--
-- O comando do pg_cron lê URL e service key do VAULT em tempo de execução —
-- sobrevive a rotação de chaves (desde que o segredo do vault seja atualizado).
-- ═══════════════════════════════════════════════════════════════════════════

DO $do$
DECLARE
  _row_id uuid;
  _job_id bigint;
  _cmd_rodar text;
  _cmd_aplicar text;
BEGIN
  _cmd_rodar := $cmd$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1) || '/functions/v1/audit-ia-auto',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
      ),
      body := '{"fase":"rodar","janela_horas":168,"severidade_minima":"warn","amostra_limpos_pct":10}'::jsonb
    ) AS request_id;
  $cmd$;

  _cmd_aplicar := $cmd$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1) || '/functions/v1/audit-ia-auto',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
      ),
      body := '{"fase":"aplicar"}'::jsonb
    ) AS request_id;
  $cmd$;

  -- ── Job 1: rodar auditoria (segunda 08:00 UTC = 05:00 SP) ──
  IF NOT EXISTS (SELECT 1 FROM public.cron_jobs WHERE funcao_alvo = 'audit-ia-auto' AND payload->>'fase' = 'rodar') THEN
    INSERT INTO public.cron_jobs (nome, descricao, expressao_cron, funcao_alvo, payload, ativo)
    VALUES (
      'Aprendizado IA — auditar semana',
      'Audita as conversas da última semana (frustração, loops, divergências). Fase 1 do aprendizado automático.',
      '0 8 * * 1',
      'audit-ia-auto',
      '{"fase":"rodar","janela_horas":168,"severidade_minima":"warn","amostra_limpos_pct":10}'::jsonb,
      true
    )
    RETURNING id INTO _row_id;

    SELECT public.schedule_cron_job('cron_' || replace(_row_id::text, '-', '_'), '0 8 * * 1', _cmd_rodar) INTO _job_id;
    UPDATE public.cron_jobs SET pg_cron_job_id = _job_id WHERE id = _row_id;
  END IF;

  -- ── Job 2: aplicar aprendizado (segunda 09:00 UTC = 06:00 SP) ──
  IF NOT EXISTS (SELECT 1 FROM public.cron_jobs WHERE funcao_alvo = 'audit-ia-auto' AND payload->>'fase' = 'aplicar') THEN
    INSERT INTO public.cron_jobs (nome, descricao, expressao_cron, funcao_alvo, payload, ativo)
    VALUES (
      'Aprendizado IA — aplicar correções',
      'Consolida os achados da auditoria, aplica correções seguras (regras, exemplos, instruções), recompila o prompt e notifica. Fase 2 do aprendizado automático.',
      '0 9 * * 1',
      'audit-ia-auto',
      '{"fase":"aplicar"}'::jsonb,
      true
    )
    RETURNING id INTO _row_id;

    SELECT public.schedule_cron_job('cron_' || replace(_row_id::text, '-', '_'), '0 9 * * 1', _cmd_aplicar) INTO _job_id;
    UPDATE public.cron_jobs SET pg_cron_job_id = _job_id WHERE id = _row_id;
  END IF;
END
$do$;


ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS lojas_responsaveis text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.resolver_destinatarios_loja_por_nivel(_loja_nome text, _nivel text)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT p.id
  FROM public.profiles p
  WHERE p.ativo = true
    AND p.tipo_usuario = 'loja'
    AND (
      CASE
        WHEN _nivel = 'operador'   THEN COALESCE(NULLIF(p.cargo_loja,''), 'operador') = 'operador'
        WHEN _nivel = 'supervisor' THEN p.cargo_loja = 'supervisor'
        WHEN _nivel = 'gerente'    THEN p.cargo_loja = 'gerente'
        WHEN _nivel = 'todos'      THEN true
        ELSE false
      END
    )
    AND EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p.lojas, '{}'::text[]) || COALESCE(p.lojas_responsaveis, '{}'::text[])) AS l
      WHERE l ILIKE _loja_nome
    );
$$;

GRANT EXECUTE ON FUNCTION public.resolver_destinatarios_loja_por_nivel(text, text) TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cron_jobs WHERE nome = 'watchdog-demandas-loja') THEN
    UPDATE public.cron_jobs
       SET descricao = 'Escalona demandas sem resposta: T+15 lembrete; T+30 supervisor; T+60 gerente; T+120 status=sem_resposta',
           expressao_cron = '* * * * *',
           funcao_alvo = 'watchdog-demandas-loja',
           payload = jsonb_build_object('thresholds', jsonb_build_object('t15',15,'t30',30,'t60',60,'t120',120)),
           ativo = true,
           updated_at = now()
     WHERE nome = 'watchdog-demandas-loja';
  ELSE
    INSERT INTO public.cron_jobs (nome, descricao, expressao_cron, funcao_alvo, payload, ativo)
    VALUES (
      'watchdog-demandas-loja',
      'Escalona demandas sem resposta: T+15 lembrete; T+30 supervisor; T+60 gerente; T+120 status=sem_resposta',
      '* * * * *',
      'watchdog-demandas-loja',
      jsonb_build_object('thresholds', jsonb_build_object('t15',15,'t30',30,'t60',60,'t120',120)),
      true
    );
  END IF;
END $$;

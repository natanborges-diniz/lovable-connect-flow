
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- Create cron_jobs table
CREATE TABLE public.cron_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  descricao text,
  expressao_cron text NOT NULL DEFAULT '*/5 * * * *',
  funcao_alvo text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  ultimo_disparo timestamptz,
  pg_cron_job_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cron_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view cron_jobs"
  ON public.cron_jobs FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage cron_jobs"
  ON public.cron_jobs FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Service role full access cron_jobs"
  ON public.cron_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_cron_jobs_updated_at
  BEFORE UPDATE ON public.cron_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert pre-configured cron jobs
INSERT INTO public.cron_jobs (nome, descricao, expressao_cron, funcao_alvo, ativo)
VALUES
  ('Agendamentos Cron', 'Motor temporal de transição de agendamentos (lojas)', '*/5 * * * *', 'agendamentos-cron', true),
  ('Recuperação de Vendas', 'Recuperação automática de leads inativos via IA', '*/15 * * * *', 'vendas-recuperacao-cron', true);

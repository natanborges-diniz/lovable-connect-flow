CREATE TABLE public.ia_auditorias_grupos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL,
  titulo text NOT NULL,
  descricao text,
  severidade text NOT NULL DEFAULT 'warn',
  auditoria_ids uuid[] NOT NULL DEFAULT '{}',
  acoes_propostas jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pendente',
  ignorado_motivo text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ia_auditorias_grupos_run ON public.ia_auditorias_grupos(run_id);

ALTER TABLE public.ia_auditorias_grupos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read ia_auditorias_grupos"
ON public.ia_auditorias_grupos FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role full ia_auditorias_grupos"
ON public.ia_auditorias_grupos FOR ALL TO service_role USING (true) WITH CHECK (true);
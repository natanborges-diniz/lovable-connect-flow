
CREATE TABLE IF NOT EXISTS public.bridge_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte text NOT NULL,
  data_alvo date NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','bridge_down','parcial','vazio')),
  linhas_recebidas integer NOT NULL DEFAULT 0,
  erro_msg text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  executado_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bridge_sync_log_fonte_data_uniq
  ON public.bridge_sync_log(fonte, data_alvo);

CREATE INDEX IF NOT EXISTS bridge_sync_log_executado_at_idx
  ON public.bridge_sync_log(executado_at DESC);

GRANT SELECT ON public.bridge_sync_log TO authenticated;
GRANT ALL ON public.bridge_sync_log TO service_role;

ALTER TABLE public.bridge_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/operador pode ler bridge_sync_log"
  ON public.bridge_sync_log
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operador')
  );

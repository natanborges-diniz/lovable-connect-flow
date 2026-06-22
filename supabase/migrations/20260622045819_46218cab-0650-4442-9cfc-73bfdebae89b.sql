CREATE TABLE IF NOT EXISTS public.os_avisos_armacao_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  os_numero text NOT NULL,
  loja_nome text NOT NULL,
  cod_empresa text NULL,
  contato_id uuid NULL REFERENCES public.contatos(id) ON DELETE SET NULL,
  cliente_telefone text NULL,
  data_movimentacao date NOT NULL,
  enviado_at timestamptz NOT NULL DEFAULT now(),
  template_alias text NOT NULL DEFAULT 'aviso_aguardando_armacao',
  status text NOT NULL DEFAULT 'sent',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_os_avisos_armacao_log_unique
  ON public.os_avisos_armacao_log(os_numero, loja_nome);

CREATE INDEX IF NOT EXISTS idx_os_avisos_armacao_log_contato
  ON public.os_avisos_armacao_log(contato_id);

GRANT SELECT ON public.os_avisos_armacao_log TO authenticated;
GRANT ALL ON public.os_avisos_armacao_log TO service_role;

ALTER TABLE public.os_avisos_armacao_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_operador_le_log_avisos"
  ON public.os_avisos_armacao_log FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'operador'::app_role)
  );
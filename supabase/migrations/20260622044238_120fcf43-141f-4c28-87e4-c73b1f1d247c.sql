ALTER TABLE public.os_recebimento_loja
  ADD COLUMN IF NOT EXISTS agendamento_id uuid NULL REFERENCES public.agendamentos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_os_recebimento_loja_agendamento
  ON public.os_recebimento_loja(agendamento_id);

CREATE INDEX IF NOT EXISTS idx_os_recebimento_loja_contato_loja
  ON public.os_recebimento_loja(contato_id, loja_nome) WHERE agendamento_id IS NULL;
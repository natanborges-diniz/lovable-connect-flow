
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS valor_orcamento numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS valor_venda numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS numero_venda text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS numeros_os text[] DEFAULT '{}';

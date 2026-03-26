ALTER TABLE public.agendamentos 
ADD COLUMN IF NOT EXISTS tentativas_lembrete integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS tentativas_cobranca_loja integer DEFAULT 0;
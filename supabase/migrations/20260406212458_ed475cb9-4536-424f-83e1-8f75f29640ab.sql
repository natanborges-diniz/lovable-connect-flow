
CREATE TABLE public.lembretes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contato_id UUID NOT NULL REFERENCES public.contatos(id) ON DELETE CASCADE,
  atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  mensagem TEXT NOT NULL,
  data_disparo TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.lembretes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage lembretes"
  ON public.lembretes FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access lembretes"
  ON public.lembretes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_lembretes_pendentes ON public.lembretes (data_disparo) WHERE status = 'pendente';

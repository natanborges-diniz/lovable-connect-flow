
-- Tabela de agendamentos
CREATE TABLE public.agendamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL REFERENCES public.contatos(id) ON DELETE CASCADE,
  atendimento_id uuid REFERENCES public.atendimentos(id),
  loja_nome text NOT NULL,
  loja_telefone text,
  data_horario timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'agendado',
  observacoes text,
  lembrete_enviado boolean DEFAULT false,
  confirmacao_enviada boolean DEFAULT false,
  noshow_enviado boolean DEFAULT false,
  cobranca_loja_enviada boolean DEFAULT false,
  loja_confirmou_presenca boolean,
  noshow_agendar_para timestamptz,
  tentativas_recuperacao int DEFAULT 0,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage agendamentos"
  ON public.agendamentos FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Service role full access
CREATE POLICY "Service role full access agendamentos"
  ON public.agendamentos FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Trigger updated_at
CREATE TRIGGER update_agendamentos_updated_at
  BEFORE UPDATE ON public.agendamentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Colunas extras em telefones_lojas
ALTER TABLE public.telefones_lojas ADD COLUMN IF NOT EXISTS horario_abertura text DEFAULT '08:00';
ALTER TABLE public.telefones_lojas ADD COLUMN IF NOT EXISTS horario_fechamento text DEFAULT '19:00';
ALTER TABLE public.telefones_lojas ADD COLUMN IF NOT EXISTS endereco text;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.agendamentos;

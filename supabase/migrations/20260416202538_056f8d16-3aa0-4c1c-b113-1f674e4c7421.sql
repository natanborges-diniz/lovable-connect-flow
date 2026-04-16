-- Sequência para o número curto de cada demanda (usado como #NN no WhatsApp)
CREATE SEQUENCE IF NOT EXISTS public.demanda_numero_seq START 1;

-- Tabela principal: cada demanda do operador para uma loja
CREATE TABLE public.demandas_loja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_curto integer NOT NULL DEFAULT nextval('public.demanda_numero_seq'),
  protocolo text NOT NULL,
  atendimento_cliente_id uuid NOT NULL,
  contato_cliente_id uuid NOT NULL,
  loja_telefone text NOT NULL,
  loja_nome text NOT NULL,
  solicitante_id uuid,
  solicitante_nome text,
  pergunta text NOT NULL,
  status text NOT NULL DEFAULT 'aberta',
  ultima_mensagem_loja_at timestamptz,
  vista_pelo_operador boolean NOT NULL DEFAULT true,
  encerrada_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_demandas_loja_numero_curto ON public.demandas_loja(numero_curto);
CREATE INDEX idx_demandas_loja_atendimento ON public.demandas_loja(atendimento_cliente_id);
CREATE INDEX idx_demandas_loja_telefone_status ON public.demandas_loja(loja_telefone, status);
CREATE INDEX idx_demandas_loja_status ON public.demandas_loja(status);

ALTER TABLE public.demandas_loja ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage demandas_loja"
  ON public.demandas_loja FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access demandas_loja"
  ON public.demandas_loja FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Trigger para updated_at
CREATE TRIGGER trg_demandas_loja_updated_at
  BEFORE UPDATE ON public.demandas_loja
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela de mensagens internas da demanda (operador <-> loja)
CREATE TABLE public.demanda_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demanda_id uuid NOT NULL REFERENCES public.demandas_loja(id) ON DELETE CASCADE,
  direcao text NOT NULL, -- 'operador_para_loja' | 'loja_para_operador' | 'sistema'
  autor_id uuid,
  autor_nome text,
  conteudo text NOT NULL,
  tipo_conteudo text NOT NULL DEFAULT 'text',
  anexo_url text,
  anexo_mime text,
  encaminhada_ao_cliente boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_demanda_mensagens_demanda ON public.demanda_mensagens(demanda_id, created_at);

ALTER TABLE public.demanda_mensagens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage demanda_mensagens"
  ON public.demanda_mensagens FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access demanda_mensagens"
  ON public.demanda_mensagens FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Habilita realtime para ambas as tabelas
ALTER PUBLICATION supabase_realtime ADD TABLE public.demandas_loja;
ALTER PUBLICATION supabase_realtime ADD TABLE public.demanda_mensagens;
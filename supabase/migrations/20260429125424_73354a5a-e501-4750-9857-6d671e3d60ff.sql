
-- Indicador "loja viu" no thread do operador.
-- Marca quando a primeira loja-destino visualizou a mensagem do operador.
ALTER TABLE public.demanda_mensagens
  ADD COLUMN IF NOT EXISTS visto_pela_loja_at timestamp with time zone DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS visto_por_loja_user_id uuid DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_demanda_mensagens_visto_loja
  ON public.demanda_mensagens (demanda_id) WHERE visto_pela_loja_at IS NOT NULL;

-- Permitir abrir demanda sem atendimento (botão global em /demandas).
-- atendimento_cliente_id e contato_cliente_id já são nullable na tabela; nada a alterar no schema.

COMMENT ON COLUMN public.demanda_mensagens.visto_pela_loja_at IS
  'Timestamp em que a primeira loja-destino abriu o thread no app InFoco Messenger. Usado para mostrar ✓✓ no painel do operador.';

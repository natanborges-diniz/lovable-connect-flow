-- Tabela de touchpoints da régua pós-venda.
-- Um touchpoint por (inscricao_id, tipo) — UNIQUE garante idempotência.
-- Status inicial: PENDENTE. Atualizado pelo worker de disparo (Onda 1b).

CREATE TABLE public.regua_touchpoint (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inscricao_id     uuid        NOT NULL REFERENCES public.regua_inscricao(id) ON DELETE CASCADE,
  tipo             text        NOT NULL
                               CHECK (tipo IN ('PRIMEIRO_CONTATO', 'ADAPTACAO_7D', 'ANIVERSARIO')),
  data_prevista    date        NOT NULL,
  status           text        NOT NULL DEFAULT 'PENDENTE'
                               CHECK (status IN ('PENDENTE', 'ENVIADO', 'FALHOU', 'ENTREGUE', 'LIDO', 'CANCELADO')),
  -- Preenchidos quando disparado (Onda 1b)
  template_key     text,
  canal            text,
  enviado_at       timestamptz,
  status_entrega   text,
  mensagem_id      text,       -- ID da mensagem no provedor WA
  metadata         jsonb,
  -- Auditoria
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT regua_touchpoint_inscricao_tipo_key
    UNIQUE (inscricao_id, tipo)
);

-- Índice para o worker de disparo: busca PENDENTE por data_prevista
CREATE INDEX idx_regua_touchpoint_status_data
  ON public.regua_touchpoint (status, data_prevista);
CREATE INDEX idx_regua_touchpoint_inscricao_id
  ON public.regua_touchpoint (inscricao_id);

-- RLS: padrão das demais tabelas de atendimento
ALTER TABLE public.regua_touchpoint ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated manage regua_touchpoint"
  ON public.regua_touchpoint
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access regua_touchpoint"
  ON public.regua_touchpoint
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

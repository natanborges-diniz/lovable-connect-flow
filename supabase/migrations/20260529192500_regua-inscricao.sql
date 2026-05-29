-- Tabela de inscrição na régua pós-venda.
-- Uma linha por (cod_cliente, data_entrega) — idempotência via UNIQUE.
-- contato_id é nullable: quando não há match no Supabase, gravamos mesmo assim.

CREATE TABLE public.regua_inscricao (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Vínculo com contatos (nullable = não casado)
  contato_id            uuid        REFERENCES public.contatos(id) ON DELETE SET NULL,
  match_status          text        NOT NULL DEFAULT 'nao_casado'
                                    CHECK (match_status IN ('casado_cpf', 'casado_telefone', 'nao_casado')),
  -- Dados canônicos vindos do Firebird
  cod_cliente           text        NOT NULL,
  cod_empresa           text        NOT NULL,
  data_entrega          date        NOT NULL,
  data_nascimento       date,
  numero_venda          text,
  origem                text        NOT NULL DEFAULT 'IMPORT_FIREBIRD',
  -- Dados de contato da bridge (independentes do match)
  nome_bridge           text,
  telefone_bridge       text,
  whatsapp_bridge       text,
  -- Consentimento (opt-in)
  consentimento_status  text        NOT NULL DEFAULT 'pendente'
                                    CHECK (consentimento_status IN ('pendente', 'ativo', 'optout')),
  consentimento_at      timestamptz,
  canal_consentimento   text,
  -- Auditoria
  criado_em             timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT regua_inscricao_cod_cliente_data_entrega_key
    UNIQUE (cod_cliente, data_entrega)
);

-- Índices de consulta frequente
CREATE INDEX idx_regua_inscricao_contato_id
  ON public.regua_inscricao (contato_id);
CREATE INDEX idx_regua_inscricao_data_entrega
  ON public.regua_inscricao (data_entrega);
CREATE INDEX idx_regua_inscricao_cod_empresa_data
  ON public.regua_inscricao (cod_empresa, data_entrega);
CREATE INDEX idx_regua_inscricao_match_status
  ON public.regua_inscricao (match_status);

-- RLS: padrão das demais tabelas de atendimento (authenticated = acesso pleno)
ALTER TABLE public.regua_inscricao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated manage regua_inscricao"
  ON public.regua_inscricao
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access regua_inscricao"
  ON public.regua_inscricao
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);


CREATE SEQUENCE IF NOT EXISTS protocolo_interno_seq START 1;

ALTER TABLE solicitacoes ADD COLUMN protocolo text UNIQUE;

CREATE TABLE solicitacao_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES solicitacoes(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'comprovante',
  descricao text,
  storage_path text NOT NULL,
  url_publica text NOT NULL,
  mime_type text,
  tamanho_bytes bigint,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE solicitacao_anexos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage solicitacao_anexos"
  ON solicitacao_anexos FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access solicitacao_anexos"
  ON solicitacao_anexos FOR ALL TO service_role
  USING (true) WITH CHECK (true);

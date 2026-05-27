
-- 1) Renomeia setor para refletir nova função
UPDATE public.setores SET nome = 'Estoque de Armações', updated_at = now()
WHERE id = '0e7b7572-4581-4e74-88eb-afca41ab71cf';

-- 2) Colunas do pipeline (idempotente via ON CONFLICT em (setor_id, nome))
DO $$
DECLARE
  _setor uuid := '0e7b7572-4581-4e74-88eb-afca41ab71cf';
  _cols text[][] := ARRAY[
    ARRAY['Aguardando loja',              'amber',     '10', 'confirmacao_estoque_pendente'],
    ARRAY['Peça confirmada em estoque',   'emerald',   '20', 'confirmacao_estoque_ok'],
    ARRAY['Sem estoque',                  'destructive','30','confirmacao_estoque_sem'],
    ARRAY['Faturada',                     'sky',       '40', 'confirmacao_estoque_faturada'],
    ARRAY['Cancelada',                    'muted-foreground','50','confirmacao_estoque_cancelada'],
    ARRAY['Garantias',                    'violet',    '60', 'garantias_placeholder']
  ];
  _row text[];
BEGIN
  FOREACH _row SLICE 1 IN ARRAY _cols LOOP
    INSERT INTO public.pipeline_colunas (setor_id, nome, cor, ordem, tipo_acao, ativo)
    SELECT _setor, _row[1], _row[2], _row[3]::int, _row[4], true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pipeline_colunas WHERE setor_id = _setor AND nome = _row[1]
    );
  END LOOP;
END $$;

-- 3) Sequence p/ protocolo
CREATE SEQUENCE IF NOT EXISTS public.confirmacao_estoque_numero_seq START 1;

-- 4) Tabela confirmacoes_estoque
CREATE TABLE IF NOT EXISTS public.confirmacoes_estoque (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_curto integer NOT NULL DEFAULT nextval('public.confirmacao_estoque_numero_seq'),
  protocolo text NOT NULL,
  referencia text NOT NULL,
  codigo_produto text NOT NULL,
  descricao_peca text,
  foto_url text,
  observacao_estoque text,
  loja_nome text NOT NULL,
  loja_telefone text,
  pipeline_coluna_id uuid REFERENCES public.pipeline_colunas(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'aguardando',
    -- aguardando | confirmada | sem_estoque | faturada | cancelada
  resposta_loja text,           -- 'sim' | 'nao' | null
  resposta_observacao text,
  respondida_por uuid,
  respondida_at timestamptz,
  tentativas_lembrete integer NOT NULL DEFAULT 0,
  proximo_lembrete_at timestamptz,
  solicitante_id uuid,
  solicitante_nome text,
  demanda_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_confest_status ON public.confirmacoes_estoque(status);
CREATE INDEX IF NOT EXISTS idx_confest_coluna ON public.confirmacoes_estoque(pipeline_coluna_id);
CREATE INDEX IF NOT EXISTS idx_confest_loja ON public.confirmacoes_estoque(loja_nome);
CREATE INDEX IF NOT EXISTS idx_confest_proxlembrete ON public.confirmacoes_estoque(proximo_lembrete_at) WHERE status = 'aguardando';
CREATE UNIQUE INDEX IF NOT EXISTS idx_confest_numero ON public.confirmacoes_estoque(numero_curto);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.confirmacoes_estoque TO authenticated;
GRANT ALL ON public.confirmacoes_estoque TO service_role;
GRANT USAGE ON SEQUENCE public.confirmacao_estoque_numero_seq TO authenticated, service_role;

ALTER TABLE public.confirmacoes_estoque ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated manage confirmacoes_estoque"
  ON public.confirmacoes_estoque FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access confirmacoes_estoque"
  ON public.confirmacoes_estoque FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_confest_updated_at
  BEFORE UPDATE ON public.confirmacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Trigger: muda de coluna -> chama pipeline-automations (reuso do padrão)
CREATE OR REPLACE FUNCTION public.on_confest_coluna_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _url text; _key text;
BEGIN
  IF OLD.pipeline_coluna_id IS DISTINCT FROM NEW.pipeline_coluna_id AND NEW.pipeline_coluna_id IS NOT NULL THEN
    BEGIN
      SELECT decrypted_secret INTO _url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
      SELECT decrypted_secret INTO _key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN _url := NULL; _key := NULL; END;

    IF _url IS NOT NULL AND _key IS NOT NULL THEN
      PERFORM net.http_post(
        url := _url || '/functions/v1/pipeline-automations',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || _key
        ),
        body := jsonb_build_object(
          'entity_type','confirmacao_estoque',
          'entity_id', NEW.id,
          'coluna_id', NEW.pipeline_coluna_id,
          'coluna_anterior_id', OLD.pipeline_coluna_id
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_confest_coluna_change ON public.confirmacoes_estoque;
CREATE TRIGGER trg_confest_coluna_change
  AFTER UPDATE ON public.confirmacoes_estoque
  FOR EACH ROW EXECUTE FUNCTION public.on_confest_coluna_change();

-- 6) Bucket público p/ fotos
INSERT INTO storage.buckets (id, name, public)
VALUES ('estoque-confirmacoes', 'estoque-confirmacoes', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Estoque fotos publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'estoque-confirmacoes');

CREATE POLICY "Authenticated can upload estoque fotos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'estoque-confirmacoes');

CREATE POLICY "Authenticated can update estoque fotos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'estoque-confirmacoes');

CREATE POLICY "Authenticated can delete estoque fotos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'estoque-confirmacoes');

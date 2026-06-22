-- regua_inscricao: PIN + termos
ALTER TABLE public.regua_inscricao
  ADD COLUMN IF NOT EXISTS pin_hash text,
  ADD COLUMN IF NOT EXISTS pin_expira_at timestamptz,
  ADD COLUMN IF NOT EXISTS pin_tentativas smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_confirmado_at timestamptz,
  ADD COLUMN IF NOT EXISTS termos_versao text,
  ADD COLUMN IF NOT EXISTS ip_origem_consultor inet;

-- canais: status do telefone + contadores de telemetria
ALTER TABLE public.canais
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'nao_validado',
  ADD COLUMN IF NOT EXISTS validado_at timestamptz,
  ADD COLUMN IF NOT EXISTS canal_consentimento text,
  ADD COLUMN IF NOT EXISTS termos_versao text,
  ADD COLUMN IF NOT EXISTS ultimo_motivo_falha text,
  ADD COLUMN IF NOT EXISTS ultima_falha_at timestamptz,
  ADD COLUMN IF NOT EXISTS tentativas_enviadas int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tentativas_entregues int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tentativas_lidas int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tentativas_respondidas int NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'canais_status_chk'
  ) THEN
    ALTER TABLE public.canais
      ADD CONSTRAINT canais_status_chk
      CHECK (status IN ('nao_validado','validado','pessoa_errada','invalido','sem_resposta'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_canais_status ON public.canais(status);
CREATE INDEX IF NOT EXISTS idx_canais_ultimo_motivo ON public.canais(ultimo_motivo_falha)
  WHERE ultimo_motivo_falha IS NOT NULL;

-- Helper para upsert atômico de status em canais a partir de um telefone (E.164 sem '+')
CREATE OR REPLACE FUNCTION public.canal_registrar_evento(
  _telefone text,
  _evento   text,  -- 'enviado' | 'entregue' | 'lido' | 'respondido' | 'falhou' | 'pessoa_errada' | 'validado'
  _motivo   text DEFAULT NULL,
  _canal_consentimento text DEFAULT NULL,
  _termos_versao text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _contato_id uuid;
BEGIN
  IF _telefone IS NULL OR length(_telefone) < 8 THEN RETURN; END IF;

  -- localiza contato pelo telefone (tenta com e sem 55)
  SELECT id INTO _contato_id FROM contatos
   WHERE telefone = _telefone
   LIMIT 1;
  IF _contato_id IS NULL AND _telefone ~ '^55' THEN
    SELECT id INTO _contato_id FROM contatos
     WHERE telefone = substr(_telefone, 3)
     LIMIT 1;
  END IF;
  IF _contato_id IS NULL THEN
    SELECT id INTO _contato_id FROM contatos
     WHERE telefone = '55' || _telefone
     LIMIT 1;
  END IF;
  IF _contato_id IS NULL THEN RETURN; END IF;

  -- garante linha em canais para esse telefone
  INSERT INTO canais (contato_id, tipo, identificador, principal, provedor)
  VALUES (_contato_id, 'whatsapp', _telefone, true, 'meta_official')
  ON CONFLICT DO NOTHING;

  IF _evento = 'enviado' THEN
    UPDATE canais SET tentativas_enviadas = tentativas_enviadas + 1
     WHERE contato_id = _contato_id AND identificador = _telefone;
  ELSIF _evento = 'entregue' THEN
    UPDATE canais SET tentativas_entregues = tentativas_entregues + 1
     WHERE contato_id = _contato_id AND identificador = _telefone;
  ELSIF _evento = 'lido' THEN
    UPDATE canais SET tentativas_lidas = tentativas_lidas + 1
     WHERE contato_id = _contato_id AND identificador = _telefone;
  ELSIF _evento = 'respondido' THEN
    UPDATE canais SET tentativas_respondidas = tentativas_respondidas + 1
     WHERE contato_id = _contato_id AND identificador = _telefone;
  ELSIF _evento = 'falhou' THEN
    UPDATE canais
       SET ultimo_motivo_falha = COALESCE(_motivo,'entrega_falhou'),
           ultima_falha_at = now(),
           status = CASE WHEN _motivo = 'numero_invalido' THEN 'invalido' ELSE status END
     WHERE contato_id = _contato_id AND identificador = _telefone;
  ELSIF _evento = 'pessoa_errada' THEN
    UPDATE canais
       SET status = 'pessoa_errada',
           ultimo_motivo_falha = 'pessoa_errada',
           ultima_falha_at = now()
     WHERE contato_id = _contato_id AND identificador = _telefone;
  ELSIF _evento = 'validado' THEN
    UPDATE canais
       SET status = 'validado',
           validado_at = now(),
           canal_consentimento = COALESCE(_canal_consentimento, canal_consentimento),
           termos_versao = COALESCE(_termos_versao, termos_versao),
           ultimo_motivo_falha = NULL,
           ultima_falha_at = NULL
     WHERE contato_id = _contato_id AND identificador = _telefone;
  END IF;

  -- trilha em eventos_crm
  INSERT INTO eventos_crm (contato_id, tipo, descricao, metadata)
  VALUES (
    _contato_id,
    'contato_' || _evento,
    'Telemetria de canal WhatsApp',
    jsonb_build_object('telefone', _telefone, 'motivo', _motivo)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.canal_registrar_evento(text,text,text,text,text) TO service_role;

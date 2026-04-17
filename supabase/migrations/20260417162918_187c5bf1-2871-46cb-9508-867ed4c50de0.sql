
-- ═══════════════════════════════════════════════
-- 1. Tabela contato_ponte: WhatsApp ↔ Mensageria
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.contato_ponte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_id uuid NOT NULL UNIQUE,
  responsavel_user_id uuid NOT NULL,
  setor_id uuid,
  conversa_id text NOT NULL UNIQUE,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contato_ponte_responsavel ON public.contato_ponte(responsavel_user_id);
CREATE INDEX IF NOT EXISTS idx_contato_ponte_conversa ON public.contato_ponte(conversa_id);

ALTER TABLE public.contato_ponte ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view contato_ponte"
  ON public.contato_ponte FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can manage contato_ponte"
  ON public.contato_ponte FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access contato_ponte"
  ON public.contato_ponte FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_contato_ponte_updated
  BEFORE UPDATE ON public.contato_ponte
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════
-- 2. Resolve responsável único de um setor
-- ═══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.resolve_responsavel_setor(_setor_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = 'setor_usuario'
    AND ur.setor_id = _setor_id
    AND p.ativo = true
  GROUP BY ur.user_id
  HAVING COUNT(*) >= 1
  LIMIT 2  -- limita 2 pra detectar se tem >1
$$;

-- Helper: retorna user_id se único, NULL se 0 ou >1
CREATE OR REPLACE FUNCTION public.unique_responsavel_setor(_setor_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _users uuid[];
BEGIN
  SELECT ARRAY(
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.role = 'setor_usuario'
      AND ur.setor_id = _setor_id
      AND p.ativo = true
  ) INTO _users;
  IF array_length(_users, 1) = 1 THEN
    RETURN _users[1];
  END IF;
  RETURN NULL;
END;
$$;

-- ═══════════════════════════════════════════════
-- 3. Setup automático da ponte para um contato
-- ═══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.setup_contato_ponte(_contato_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _setor_id uuid;
  _resp_id uuid;
  _conv_id text;
  _bridge_user_id uuid := '00000000-0000-0000-0000-000000000000'::uuid; -- system "user" placeholder for conversation pairing
BEGIN
  SELECT setor_destino INTO _setor_id FROM public.contatos WHERE id = _contato_id;
  IF _setor_id IS NULL THEN
    -- sem setor → desativa ponte se existir
    UPDATE public.contato_ponte SET ativo = false WHERE contato_id = _contato_id;
    RETURN NULL;
  END IF;

  _resp_id := public.unique_responsavel_setor(_setor_id);
  IF _resp_id IS NULL THEN
    -- sem responsável único → não cria ponte
    UPDATE public.contato_ponte SET ativo = false WHERE contato_id = _contato_id;
    RETURN NULL;
  END IF;

  -- conversa_id determinístico: ponte_<contato_id>
  _conv_id := 'ponte_' || _contato_id::text;

  INSERT INTO public.contato_ponte (contato_id, responsavel_user_id, setor_id, conversa_id, ativo)
  VALUES (_contato_id, _resp_id, _setor_id, _conv_id, true)
  ON CONFLICT (contato_id) DO UPDATE
    SET responsavel_user_id = EXCLUDED.responsavel_user_id,
        setor_id = EXCLUDED.setor_id,
        ativo = true,
        updated_at = now();

  -- Marca atendimentos abertos do contato como modo='ponte'
  UPDATE public.atendimentos
  SET modo = 'ponte', updated_at = now()
  WHERE contato_id = _contato_id
    AND status <> 'encerrado'
    AND modo NOT IN ('humano', 'ponte');

  RETURN _resp_id;
END;
$$;

-- ═══════════════════════════════════════════════
-- 4. Trigger: setor_destino muda → reconfigura ponte
-- ═══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.on_contato_setor_destino_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.setor_destino IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.setor_destino IS DISTINCT FROM OLD.setor_destino) THEN
    PERFORM public.setup_contato_ponte(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contato_setor_destino_change ON public.contatos;
CREATE TRIGGER trg_contato_setor_destino_change
  AFTER INSERT OR UPDATE OF setor_destino ON public.contatos
  FOR EACH ROW EXECUTE FUNCTION public.on_contato_setor_destino_change();

-- ═══════════════════════════════════════════════
-- 5. Trigger: msg interna em conversa-ponte → WhatsApp
-- ═══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.on_mensagem_interna_ponte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _supabase_url text;
  _service_key text;
  _ponte record;
BEGIN
  -- Só processa se for conversa-ponte
  IF NEW.conversa_id NOT LIKE 'ponte_%' THEN
    RETURN NEW;
  END IF;

  -- Verifica que existe ponte ativa e que o remetente é o responsável
  SELECT * INTO _ponte FROM public.contato_ponte
  WHERE conversa_id = NEW.conversa_id AND ativo = true;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Só dispara WhatsApp se quem enviou foi o responsável (não eco do bridge)
  IF NEW.remetente_id <> _ponte.responsavel_user_id THEN
    RETURN NEW;
  END IF;

  -- Pega segredos
  BEGIN
    SELECT decrypted_secret INTO _supabase_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT decrypted_secret INTO _service_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    _supabase_url := NULL; _service_key := NULL;
  END;

  IF _supabase_url IS NULL THEN BEGIN _supabase_url := current_setting('supabase.url', true); EXCEPTION WHEN OTHERS THEN NULL; END; END IF;
  IF _service_key IS NULL THEN BEGIN _service_key := current_setting('supabase.service_role_key', true); EXCEPTION WHEN OTHERS THEN NULL; END; END IF;

  IF _supabase_url IS NOT NULL AND _service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := _supabase_url || '/functions/v1/bridge-mensageria',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _service_key
      ),
      body := jsonb_build_object(
        'direction', 'interno_to_whatsapp',
        'mensagem_interna_id', NEW.id,
        'contato_id', _ponte.contato_id,
        'conteudo', NEW.conteudo
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mensagem_interna_ponte ON public.mensagens_internas;
CREATE TRIGGER trg_mensagem_interna_ponte
  AFTER INSERT ON public.mensagens_internas
  FOR EACH ROW EXECUTE FUNCTION public.on_mensagem_interna_ponte();

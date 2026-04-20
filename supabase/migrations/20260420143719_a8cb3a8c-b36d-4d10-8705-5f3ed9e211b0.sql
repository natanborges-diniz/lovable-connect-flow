-- Canal Único: Meta Official (clientes) + App Atrium Messenger (interno)

-- 1. Normalizar atendimentos abertos para meta_official
UPDATE public.atendimentos
SET canal_provedor = 'meta_official'
WHERE canal_provedor IN ('evolution_api', 'z_api')
  AND status <> 'encerrado';

-- 2. Normalizar canais ativos para meta_official
UPDATE public.canais
SET provedor = 'meta_official'
WHERE provedor IN ('evolution_api', 'z_api');

-- 3. Desativar bot_fluxos corporativos (substituídos pelo app)
UPDATE public.bot_fluxos
SET ativo = false, updated_at = now()
WHERE tipo_bot IN ('loja', 'departamento', 'colaborador');

-- 4. Índice parcial para acelerar busca de notificações não lidas
CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario_nao_lidas
  ON public.notificacoes (usuario_id, created_at DESC)
  WHERE lida = false AND usuario_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notificacoes_setor_nao_lidas
  ON public.notificacoes (setor_id, created_at DESC)
  WHERE lida = false AND setor_id IS NOT NULL;

-- 5. Função: resolver_destinatarios_loja(nome_loja)
-- Retorna user_ids ativos no setor responsável pela loja informada.
CREATE OR REPLACE FUNCTION public.resolver_destinatarios_loja(_loja_nome text)
RETURNS TABLE(user_id uuid, setor_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH loja AS (
    SELECT setor_destino_id
    FROM public.telefones_lojas
    WHERE nome_loja ILIKE _loja_nome
      AND ativo = true
    LIMIT 1
  )
  SELECT DISTINCT ur.user_id, ur.setor_id
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE p.ativo = true
    AND (
      -- Match por loja_nome explícito no user_role
      (ur.role = 'setor_usuario' AND ur.loja_nome ILIKE _loja_nome)
      OR
      -- Match por setor da loja
      (ur.role IN ('setor_usuario', 'operador') AND ur.setor_id = (SELECT setor_destino_id FROM loja))
    );
$$;

-- 6. Trigger: dispatch-push em INSERT de notificacoes
CREATE OR REPLACE FUNCTION public.on_notificacao_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _supabase_url text;
  _service_key text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO _supabase_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT decrypted_secret INTO _service_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    _supabase_url := NULL; _service_key := NULL;
  END;

  IF _supabase_url IS NULL OR _service_key IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := _supabase_url || '/functions/v1/dispatch-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _service_key
    ),
    body := jsonb_build_object(
      'notificacao_id', NEW.id,
      'usuario_id', NEW.usuario_id,
      'setor_id', NEW.setor_id,
      'titulo', NEW.titulo,
      'mensagem', NEW.mensagem,
      'tipo', NEW.tipo,
      'referencia_id', NEW.referencia_id
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificacoes_dispatch_push ON public.notificacoes;
CREATE TRIGGER trg_notificacoes_dispatch_push
AFTER INSERT ON public.notificacoes
FOR EACH ROW
EXECUTE FUNCTION public.on_notificacao_dispatch_push();
-- 1) profiles: cargo_loja + lojas[]
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cargo_loja text,
  ADD COLUMN IF NOT EXISTS lojas text[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_cargo_loja_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_cargo_loja_check
      CHECK (cargo_loja IS NULL OR cargo_loja IN ('supervisor','gerente','operador'));
  END IF;
END $$;

-- 2) bot_menu_opcoes: cargos_visiveis[]
ALTER TABLE public.bot_menu_opcoes
  ADD COLUMN IF NOT EXISTS cargos_visiveis text[] NOT NULL DEFAULT '{}';

-- 3) Sync user_roles a partir de profiles.lojas (1 linha por loja)
CREATE OR REPLACE FUNCTION public.sync_user_roles_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _loja text;
BEGIN
  -- Só age se houve mudança relevante
  IF TG_OP = 'UPDATE'
     AND NEW.tipo_usuario IS NOT DISTINCT FROM OLD.tipo_usuario
     AND NEW.lojas IS NOT DISTINCT FROM OLD.lojas
     AND NEW.setor_id IS NOT DISTINCT FROM OLD.setor_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.tipo_usuario = 'loja' THEN
    -- Remove roles atuais que não sejam admin
    DELETE FROM public.user_roles
    WHERE user_id = NEW.id AND role <> 'admin';

    -- Insere uma linha setor_usuario por loja
    IF array_length(NEW.lojas, 1) IS NOT NULL THEN
      FOREACH _loja IN ARRAY NEW.lojas LOOP
        INSERT INTO public.user_roles (user_id, role, loja_nome)
        VALUES (NEW.id, 'setor_usuario', _loja)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  ELSIF NEW.tipo_usuario = 'setor_operador' AND NEW.setor_id IS NOT NULL THEN
    -- Garante role setor_usuario com setor_id
    DELETE FROM public.user_roles
    WHERE user_id = NEW.id AND role = 'setor_usuario';
    INSERT INTO public.user_roles (user_id, role, setor_id)
    VALUES (NEW.id, 'setor_usuario', NEW.setor_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_roles_from_profile ON public.profiles;
CREATE TRIGGER trg_sync_user_roles_from_profile
AFTER INSERT OR UPDATE OF tipo_usuario, lojas, setor_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_user_roles_from_profile();

-- 4) Helper: filtrar opções de menu visíveis para um cargo
CREATE OR REPLACE FUNCTION public.get_menu_opcoes_para_cargo(_tipo_bot text, _parent_id uuid, _cargo text)
RETURNS SETOF public.bot_menu_opcoes
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.bot_menu_opcoes
  WHERE ativo = true
    AND tipo_bot = _tipo_bot
    AND ((_parent_id IS NULL AND parent_id IS NULL) OR parent_id = _parent_id)
    AND (
      cargos_visiveis = '{}'::text[]   -- vazio = visível para todos
      OR _cargo IS NULL                -- usuário sem cargo definido vê tudo
      OR _cargo = ANY(cargos_visiveis)
    )
  ORDER BY ordem;
$$;
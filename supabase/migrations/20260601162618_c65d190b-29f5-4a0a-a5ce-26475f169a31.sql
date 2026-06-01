-- =========================================================
-- user_acessos: fonte única para módulos + escopo
-- =========================================================
CREATE TABLE IF NOT EXISTS public.user_acessos (
  user_id uuid PRIMARY KEY,
  modulos jsonb NOT NULL DEFAULT '{}'::jsonb,
  lojas text[] NULL,
  setores uuid[] NULL,
  acesso_total boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_acessos TO authenticated;
GRANT ALL ON public.user_acessos TO service_role;

ALTER TABLE public.user_acessos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage user_acessos"
ON public.user_acessos FOR ALL TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Users read own user_acessos"
ON public.user_acessos FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Service role full user_acessos"
ON public.user_acessos FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_user_acessos()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_user_acessos
BEFORE UPDATE ON public.user_acessos
FOR EACH ROW EXECUTE FUNCTION public.touch_user_acessos();

-- =========================================================
-- Sincroniza profiles.tipo_usuario + user_roles a partir de user_acessos
-- =========================================================
CREATE OR REPLACE FUNCTION public.sync_from_user_acessos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo text;
  v_role text;
  v_first_setor uuid;
  v_has_web boolean;
  v_has_loja_menu boolean;
BEGIN
  -- Determina tipo_usuario derivado
  IF NEW.acesso_total THEN
    v_tipo := 'admin';
    v_role := 'admin';
  ELSE
    v_has_web := (NEW.modulos ?| ARRAY['dashboard','crm','lojas','financeiro','ti','interno','estoque','tarefas','configuracoes']);
    v_has_loja_menu := (NEW.modulos ? 'menu_loja');

    IF v_has_loja_menu AND NOT v_has_web THEN
      v_tipo := 'loja';
      v_role := 'setor_usuario';
    ELSIF (NEW.setores IS NOT NULL AND array_length(NEW.setores,1) > 0) THEN
      v_tipo := 'setor_operador';
      v_role := 'setor_usuario';
    ELSE
      v_tipo := 'colaborador';
      v_role := 'operador';
    END IF;
  END IF;

  -- Atualiza profiles
  UPDATE public.profiles
     SET tipo_usuario = v_tipo,
         lojas        = COALESCE(NEW.lojas, '{}'::text[]),
         setor_id     = CASE
                          WHEN NEW.setores IS NOT NULL AND array_length(NEW.setores,1) > 0
                            THEN NEW.setores[1]
                          ELSE NULL
                        END
   WHERE id = NEW.user_id;

  -- Limpa user_roles e reinsere conforme acesso
  DELETE FROM public.user_roles WHERE user_id = NEW.user_id;

  IF v_role = 'admin' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.user_id, 'admin'::app_role);
  ELSIF v_role = 'operador' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.user_id, 'operador'::app_role);
  ELSE
    -- setor_usuario: uma linha por setor; se for tipo loja sem setor, cria 1 linha por loja
    IF NEW.setores IS NOT NULL AND array_length(NEW.setores,1) > 0 THEN
      INSERT INTO public.user_roles (user_id, role, setor_id)
      SELECT NEW.user_id, 'setor_usuario'::app_role, s
        FROM unnest(NEW.setores) s;
    ELSIF NEW.lojas IS NOT NULL AND array_length(NEW.lojas,1) > 0 THEN
      INSERT INTO public.user_roles (user_id, role, loja_nome)
      SELECT NEW.user_id, 'setor_usuario'::app_role, l
        FROM unnest(NEW.lojas) l;
    ELSE
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.user_id, 'setor_usuario'::app_role);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_from_user_acessos ON public.user_acessos;
CREATE TRIGGER trg_sync_from_user_acessos
AFTER INSERT OR UPDATE ON public.user_acessos
FOR EACH ROW EXECUTE FUNCTION public.sync_from_user_acessos();

-- =========================================================
-- Helper: has_modulo() para usar em RLS futuras / lógica
-- =========================================================
CREATE OR REPLACE FUNCTION public.has_modulo(_user_id uuid, _modulo text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_acessos
     WHERE user_id = _user_id
       AND (acesso_total = true OR (modulos ? _modulo))
  );
$$;

-- =========================================================
-- Backfill a partir dos dados atuais
-- =========================================================
INSERT INTO public.user_acessos (user_id, modulos, lojas, setores, acesso_total)
SELECT
  p.id,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'admin'::app_role)
      THEN jsonb_build_object(
        'dashboard','agir','crm','agir','lojas','agir','financeiro','agir',
        'ti','agir','interno','agir','estoque','agir','tarefas','agir',
        'mensagens','agir','demandas','agir','configuracoes','agir',
        'chat_1a1','agir','chat_grupo','agir','demandas_minhas_lojas','agir','menu_loja','agir'
      )
    WHEN p.tipo_usuario = 'loja' THEN
      jsonb_build_object(
        'lojas','agir','mensagens','agir','tarefas','agir','demandas','agir',
        'chat_1a1','agir','demandas_minhas_lojas','agir','menu_loja','agir'
      )
    WHEN p.tipo_usuario = 'setor_operador' THEN
      jsonb_build_object('interno','agir','mensagens','agir','tarefas','agir','chat_1a1','agir')
    ELSE
      jsonb_build_object('mensagens','agir','tarefas','agir','chat_1a1','agir','chat_grupo','agir')
  END AS modulos,
  COALESCE(p.lojas, '{}'::text[]) AS lojas,
  CASE WHEN p.setor_id IS NOT NULL THEN ARRAY[p.setor_id] ELSE '{}'::uuid[] END AS setores,
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'admin'::app_role) AS acesso_total
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;
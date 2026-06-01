-- Granularidade por usuário no menu do bot
ALTER TABLE public.bot_menu_opcoes
  ADD COLUMN IF NOT EXISTS usuarios_visiveis uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.bot_menu_opcoes.usuarios_visiveis IS
  'Whitelist explícita de profiles.id. Quando não vazia, SOBREPÕE cargos_visiveis: só esses usuários veem o item.';

-- RPC atualizada: whitelist por usuário tem prioridade sobre cargos_visiveis
CREATE OR REPLACE FUNCTION public.get_menu_opcoes_para_cargo(
  _tipo_bot text,
  _parent_id uuid,
  _cargo text,
  _user_id uuid DEFAULT NULL
)
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
      CASE
        WHEN cardinality(usuarios_visiveis) > 0
          THEN _user_id IS NOT NULL AND _user_id = ANY(usuarios_visiveis)
        ELSE
          cargos_visiveis = '{}'::text[]
          OR _cargo IS NULL
          OR _cargo = ANY(cargos_visiveis)
      END
    )
  ORDER BY ordem;
$$;

-- Açúcar: resolve o cargo do profile automaticamente
CREATE OR REPLACE FUNCTION public.get_menu_opcoes_para_usuario(
  _tipo_bot text,
  _parent_id uuid,
  _user_id uuid
)
RETURNS SETOF public.bot_menu_opcoes
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.get_menu_opcoes_para_cargo(
    _tipo_bot,
    _parent_id,
    (SELECT cargo_loja FROM public.profiles WHERE id = _user_id),
    _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_menu_opcoes_para_usuario(text, uuid, uuid) TO authenticated, service_role;
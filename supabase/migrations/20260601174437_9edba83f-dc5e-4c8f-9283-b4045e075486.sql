-- RPC: define em lote quais opções de bot_menu_opcoes um usuário enxerga
-- Adiciona o user_id em usuarios_visiveis das opções listadas e remove das demais.
CREATE OR REPLACE FUNCTION public.set_bot_menu_visibility_for_user(
  _user_id uuid,
  _opcao_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id obrigatório';
  END IF;

  -- Adiciona o usuário nas opções marcadas (idempotente)
  UPDATE public.bot_menu_opcoes
     SET usuarios_visiveis = (
           SELECT ARRAY(SELECT DISTINCT unnest(COALESCE(usuarios_visiveis, '{}'::uuid[]) || ARRAY[_user_id]))
         ),
         updated_at = now()
   WHERE id = ANY(COALESCE(_opcao_ids, '{}'::uuid[]))
     AND NOT (_user_id = ANY(COALESCE(usuarios_visiveis, '{}'::uuid[])));

  -- Remove o usuário das opções não marcadas
  UPDATE public.bot_menu_opcoes
     SET usuarios_visiveis = ARRAY(
           SELECT u FROM unnest(usuarios_visiveis) AS u WHERE u <> _user_id
         ),
         updated_at = now()
   WHERE _user_id = ANY(COALESCE(usuarios_visiveis, '{}'::uuid[]))
     AND NOT (id = ANY(COALESCE(_opcao_ids, '{}'::uuid[])));
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_bot_menu_visibility_for_user(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_bot_menu_visibility_for_user(uuid, uuid[]) TO service_role;
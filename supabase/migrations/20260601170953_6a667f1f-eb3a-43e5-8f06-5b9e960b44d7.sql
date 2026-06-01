CREATE OR REPLACE FUNCTION public.resolver_destinatarios_loja_por_nivel(_loja_nome text, _nivel text)
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT p.id
  FROM public.profiles p
  LEFT JOIN public.user_acessos ua ON ua.user_id = p.id
  WHERE p.ativo = true
    AND p.tipo_usuario = 'loja'
    AND (
      CASE
        WHEN _nivel = 'operador'   THEN COALESCE(NULLIF(p.cargo_loja,''), 'operador') = 'operador'
        WHEN _nivel = 'supervisor' THEN p.cargo_loja = 'supervisor'
        WHEN _nivel = 'gerente'    THEN p.cargo_loja = 'gerente'
        WHEN _nivel = 'todos'      THEN true
        ELSE false
      END
    )
    AND EXISTS (
      SELECT 1
      FROM unnest(
        COALESCE(ua.lojas, p.lojas, '{}'::text[])
      ) AS l
      WHERE l ILIKE _loja_nome
    );
$function$;
CREATE OR REPLACE FUNCTION public.resolver_destinatarios_atendimento(_atendimento_id uuid)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _atendente uuid;
  _contato_id uuid;
  _setor_id uuid;
  _ids uuid[];
BEGIN
  SELECT atendente_user_id, contato_id INTO _atendente, _contato_id
  FROM public.atendimentos WHERE id = _atendimento_id;

  -- 1) Atendente atribuído
  IF _atendente IS NOT NULL THEN
    RETURN ARRAY[_atendente];
  END IF;

  -- 2) Fallback por setor da coluna do contato
  SELECT pc.setor_id INTO _setor_id
  FROM public.contatos c
  LEFT JOIN public.pipeline_colunas pc ON pc.id = c.pipeline_coluna_id
  WHERE c.id = _contato_id;

  IF _setor_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT p.id) INTO _ids
    FROM public.profiles p
    WHERE p.ativo = true
      AND (p.setor_id = _setor_id
           OR EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = p.id AND ur.setor_id = _setor_id));
    IF _ids IS NOT NULL AND array_length(_ids, 1) IS NOT NULL THEN
      RETURN _ids;
    END IF;
  END IF;

  -- 3) Fallback final: todos operadores corporativos (admin/colaborador) ativos
  SELECT ARRAY_AGG(DISTINCT p.id) INTO _ids
  FROM public.profiles p
  WHERE p.ativo = true
    AND p.tipo_usuario IN ('admin', 'colaborador');

  RETURN COALESCE(_ids, '{}'::uuid[]);
END;
$function$;
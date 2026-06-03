
-- Atualiza tipo_usuario para 'loja' onde aplica
UPDATE public.profiles p
   SET tipo_usuario = 'loja'
  FROM public.user_acessos ua
 WHERE p.id = ua.user_id
   AND NOT ua.acesso_total
   AND ua.lojas IS NOT NULL AND array_length(ua.lojas,1) > 0
   AND COALESCE(array_length(ua.setores,1), 0) = 0
   AND p.tipo_usuario <> 'loja';

-- Insere user_roles para esses casos
INSERT INTO public.user_roles (user_id, role, loja_nome)
SELECT ua.user_id, 'setor_usuario'::app_role, l
  FROM public.user_acessos ua, unnest(ua.lojas) l
 WHERE NOT ua.acesso_total
   AND ua.lojas IS NOT NULL AND array_length(ua.lojas,1) > 0
   AND COALESCE(array_length(ua.setores,1), 0) = 0
   AND NOT EXISTS (
     SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = ua.user_id
        AND ur.role = 'setor_usuario'::app_role
        AND ur.loja_nome = l
   );

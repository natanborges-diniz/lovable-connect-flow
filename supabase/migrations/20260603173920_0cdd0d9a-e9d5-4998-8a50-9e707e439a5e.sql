
CREATE OR REPLACE FUNCTION public.sync_from_user_acessos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tipo text;
  v_role text;
  v_has_web boolean;
  v_has_loja_menu boolean;
  v_has_lojas boolean;
  v_has_setores boolean;
BEGIN
  v_has_lojas   := (NEW.lojas   IS NOT NULL AND array_length(NEW.lojas,1)   > 0);
  v_has_setores := (NEW.setores IS NOT NULL AND array_length(NEW.setores,1) > 0);

  IF NEW.acesso_total THEN
    v_tipo := 'admin';
    v_role := 'admin';
  ELSE
    v_has_web := (NEW.modulos ?| ARRAY['dashboard','crm','lojas','financeiro','ti','interno','estoque','tarefas','configuracoes']);
    v_has_loja_menu := (NEW.modulos ? 'menu_loja');

    -- Regra principal: escopo por loja vence — mesmo com módulos web habilitados
    IF v_has_lojas AND NOT v_has_setores THEN
      v_tipo := 'loja';
      v_role := 'setor_usuario';
    ELSIF v_has_loja_menu AND NOT v_has_web THEN
      v_tipo := 'loja';
      v_role := 'setor_usuario';
    ELSIF v_has_setores THEN
      v_tipo := 'setor_operador';
      v_role := 'setor_usuario';
    ELSE
      v_tipo := 'colaborador';
      v_role := 'operador';
    END IF;
  END IF;

  UPDATE public.profiles
     SET tipo_usuario = v_tipo,
         lojas        = COALESCE(NEW.lojas, '{}'::text[]),
         setor_id     = CASE WHEN v_has_setores THEN NEW.setores[1] ELSE NULL END
   WHERE id = NEW.user_id;

  DELETE FROM public.user_roles WHERE user_id = NEW.user_id;

  IF v_role = 'admin' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.user_id, 'admin'::app_role);
  ELSIF v_role = 'operador' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.user_id, 'operador'::app_role);
  ELSE
    -- setor_usuario: prioriza lojas (operador de loja) sobre setores
    IF v_tipo = 'loja' AND v_has_lojas THEN
      INSERT INTO public.user_roles (user_id, role, loja_nome)
      SELECT NEW.user_id, 'setor_usuario'::app_role, l
        FROM unnest(NEW.lojas) l;
    ELSIF v_has_setores THEN
      INSERT INTO public.user_roles (user_id, role, setor_id)
      SELECT NEW.user_id, 'setor_usuario'::app_role, s
        FROM unnest(NEW.setores) s;
    ELSIF v_has_lojas THEN
      INSERT INTO public.user_roles (user_id, role, loja_nome)
      SELECT NEW.user_id, 'setor_usuario'::app_role, l
        FROM unnest(NEW.lojas) l;
    ELSE
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.user_id, 'setor_usuario'::app_role);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Backfill: reaplica trigger para todos os registros existentes
UPDATE public.user_acessos SET updated_at = now();

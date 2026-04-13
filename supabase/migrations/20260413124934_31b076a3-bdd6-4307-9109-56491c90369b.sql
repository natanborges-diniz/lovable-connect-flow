
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _default_role text;
  _default_setor text;
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email), NEW.email);

  SELECT valor INTO _default_role FROM public.configuracoes_ia WHERE chave = 'default_role' AND valor <> '';
  SELECT valor INTO _default_setor FROM public.configuracoes_ia WHERE chave = 'default_setor_id' AND valor <> '';

  IF _default_role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, setor_id)
    VALUES (NEW.id, _default_role::app_role, CASE WHEN _default_setor IS NOT NULL THEN _default_setor::uuid ELSE NULL END)
    ON CONFLICT DO NOTHING;

    IF _default_setor IS NOT NULL THEN
      UPDATE public.profiles SET setor_id = _default_setor::uuid WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Also add RLS policy for admin to update any profile
CREATE POLICY "Admins can update any profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

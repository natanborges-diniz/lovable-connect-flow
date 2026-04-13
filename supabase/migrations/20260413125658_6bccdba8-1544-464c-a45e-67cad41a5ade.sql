
-- Add loja_nome column to user_roles
ALTER TABLE public.user_roles ADD COLUMN loja_nome text;

-- Rename setor Agendamentos -> Loja
UPDATE public.setores SET nome = 'Loja' WHERE id = '277307f3-747f-4820-95a0-41f11379900a';

-- Update handle_new_user to support loja_nome default
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _default_role text;
  _default_setor text;
  _default_loja text;
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email), NEW.email);

  SELECT valor INTO _default_role FROM public.configuracoes_ia WHERE chave = 'default_role' AND valor <> '';
  SELECT valor INTO _default_setor FROM public.configuracoes_ia WHERE chave = 'default_setor_id' AND valor <> '';
  SELECT valor INTO _default_loja FROM public.configuracoes_ia WHERE chave = 'default_loja_nome' AND valor <> '';

  IF _default_role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, setor_id, loja_nome)
    VALUES (
      NEW.id,
      _default_role::app_role,
      CASE WHEN _default_setor IS NOT NULL THEN _default_setor::uuid ELSE NULL END,
      _default_loja
    )
    ON CONFLICT DO NOTHING;

    IF _default_setor IS NOT NULL THEN
      UPDATE public.profiles SET setor_id = _default_setor::uuid WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

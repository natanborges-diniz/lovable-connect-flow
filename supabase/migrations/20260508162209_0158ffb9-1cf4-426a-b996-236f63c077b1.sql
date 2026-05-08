
ALTER TABLE public.conversas_grupo
  ADD COLUMN IF NOT EXISTS tipo_origem text NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS origem_ref text;

ALTER TABLE public.conversas_grupo
  DROP CONSTRAINT IF EXISTS conversas_grupo_tipo_origem_check;
ALTER TABLE public.conversas_grupo
  ADD CONSTRAINT conversas_grupo_tipo_origem_check
  CHECK (tipo_origem IN ('setor','loja','custom'));

CREATE UNIQUE INDEX IF NOT EXISTS conversas_grupo_origem_unica
  ON public.conversas_grupo (tipo_origem, origem_ref)
  WHERE tipo_origem <> 'custom';

-- Função: recalcula participantes do grupo conforme tipo_origem
CREATE OR REPLACE FUNCTION public.calcular_membros_grupo(_tipo text, _ref text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT id ORDER BY id), '{}'::uuid[])
  FROM public.profiles
  WHERE ativo = true
    AND (
      (_tipo = 'setor' AND setor_id::text = _ref)
      OR (_tipo = 'loja' AND metadata->>'loja_nome' = _ref)
    );
$$;

-- BEFORE INSERT/UPDATE: derive participantes/nome para grupos não-custom
CREATE OR REPLACE FUNCTION public.conversas_grupo_derive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _setor_nome text;
BEGIN
  IF NEW.tipo_origem = 'setor' THEN
    IF NEW.origem_ref IS NULL THEN
      RAISE EXCEPTION 'origem_ref obrigatório para tipo_origem=setor';
    END IF;
    NEW.participantes := public.calcular_membros_grupo('setor', NEW.origem_ref);
    IF NEW.nome IS NULL OR length(trim(NEW.nome)) = 0 THEN
      SELECT nome INTO _setor_nome FROM public.setores WHERE id::text = NEW.origem_ref;
      NEW.nome := 'Setor — ' || COALESCE(_setor_nome, NEW.origem_ref);
    END IF;
  ELSIF NEW.tipo_origem = 'loja' THEN
    IF NEW.origem_ref IS NULL THEN
      RAISE EXCEPTION 'origem_ref obrigatório para tipo_origem=loja';
    END IF;
    NEW.participantes := public.calcular_membros_grupo('loja', NEW.origem_ref);
    IF NEW.nome IS NULL OR length(trim(NEW.nome)) = 0 THEN
      NEW.nome := 'Loja — ' || NEW.origem_ref;
    END IF;
  END IF;

  -- garantir criador sempre presente
  IF NEW.criado_por IS NOT NULL AND NOT (NEW.criado_por = ANY(NEW.participantes)) THEN
    NEW.participantes := NEW.participantes || NEW.criado_por;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversas_grupo_derive ON public.conversas_grupo;
CREATE TRIGGER trg_conversas_grupo_derive
BEFORE INSERT OR UPDATE OF tipo_origem, origem_ref ON public.conversas_grupo
FOR EACH ROW EXECUTE FUNCTION public.conversas_grupo_derive();

-- Ressincroniza grupos quando profile muda
CREATE OR REPLACE FUNCTION public.profiles_resync_grupos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _setores text[] := '{}';
  _lojas text[] := '{}';
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') THEN
    IF NEW.setor_id IS NOT NULL THEN _setores := array_append(_setores, NEW.setor_id::text); END IF;
    IF NEW.metadata->>'loja_nome' IS NOT NULL THEN _lojas := array_append(_lojas, NEW.metadata->>'loja_nome'); END IF;
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF OLD.setor_id IS NOT NULL THEN _setores := array_append(_setores, OLD.setor_id::text); END IF;
    IF OLD.metadata->>'loja_nome' IS NOT NULL THEN _lojas := array_append(_lojas, OLD.metadata->>'loja_nome'); END IF;
  END IF;

  UPDATE public.conversas_grupo
  SET participantes = public.calcular_membros_grupo(tipo_origem, origem_ref),
      updated_at = now()
  WHERE (tipo_origem = 'setor' AND origem_ref = ANY(_setores))
     OR (tipo_origem = 'loja'  AND origem_ref = ANY(_lojas));

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_resync_grupos ON public.profiles;
CREATE TRIGGER trg_profiles_resync_grupos
AFTER INSERT OR UPDATE OF setor_id, ativo, metadata OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_resync_grupos();

CREATE OR REPLACE FUNCTION public.sync_auditoria_grupo_on_tarefa_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grupo_id uuid;
  v_pendentes int;
  v_total int;
BEGIN
  v_grupo_id := NULLIF(NEW.metadata->>'auditoria_grupo_id', '')::uuid;
  IF v_grupo_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- só age quando uma tarefa muda para um estado terminal
  IF NEW.status NOT IN ('concluida', 'cancelada') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT
    count(*) FILTER (WHERE status NOT IN ('concluida', 'cancelada')),
    count(*)
  INTO v_pendentes, v_total
  FROM public.tarefas
  WHERE (metadata->>'auditoria_grupo_id')::uuid = v_grupo_id;

  IF v_total > 0 AND v_pendentes = 0 THEN
    UPDATE public.ia_auditorias_grupos
       SET status = 'aplicado',
           applied_at = COALESCE(applied_at, now()),
           updated_at = now()
     WHERE id = v_grupo_id
       AND status IN ('pendente_codigo', 'parcial', 'pendente');

    UPDATE public.ia_auditorias
       SET status = 'aplicado', updated_at = now()
     WHERE id = ANY(
       SELECT unnest(auditoria_ids)
       FROM public.ia_auditorias_grupos
       WHERE id = v_grupo_id
     )
     AND status <> 'aplicado';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_auditoria_grupo_on_tarefa ON public.tarefas;
CREATE TRIGGER trg_sync_auditoria_grupo_on_tarefa
AFTER INSERT OR UPDATE OF status ON public.tarefas
FOR EACH ROW
EXECUTE FUNCTION public.sync_auditoria_grupo_on_tarefa_status();
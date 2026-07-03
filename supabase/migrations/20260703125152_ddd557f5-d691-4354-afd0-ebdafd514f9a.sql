CREATE OR REPLACE FUNCTION public.audit_agendamento_horario_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.data_horario IS DISTINCT FROM NEW.data_horario THEN
    INSERT INTO public.eventos_crm (contato_id, tipo, descricao, metadata, referencia_tipo, referencia_id)
    VALUES (
      NEW.contato_id,
      'agendamento_horario_alterado',
      format('data_horario alterado: %s → %s', OLD.data_horario, NEW.data_horario),
      jsonb_build_object(
        'antes', OLD.data_horario,
        'depois', NEW.data_horario,
        'loja_nome', NEW.loja_nome,
        'status', NEW.status,
        'jwt_claims', current_setting('request.jwt.claims', true)
      ),
      'agendamento',
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_agendamento_horario ON public.agendamentos;
CREATE TRIGGER trg_audit_agendamento_horario
BEFORE UPDATE ON public.agendamentos
FOR EACH ROW
EXECUTE FUNCTION public.audit_agendamento_horario_change();
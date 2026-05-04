-- Trigger AFTER INSERT em agendamentos: notifica usuários da loja via Web Push
-- Reutiliza fn_send_push existente (que chama send-push EF). Padrão idêntico ao
-- trg_push_nova_mensagem / trg_push_nova_notificacao.

CREATE OR REPLACE FUNCTION public.trg_push_agendamento_novo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ids uuid[];
  _quando text;
  _contato_nome text;
  _body text;
BEGIN
  -- Destinatários: todos os user_roles vinculados à loja_nome do agendamento
  SELECT ARRAY(
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.loja_nome ILIKE NEW.loja_nome
      AND p.ativo = true
      AND ur.user_id IS NOT NULL
  ) INTO _ids;

  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  _quando := to_char(NEW.data_horario AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24:MI');

  SELECT nome INTO _contato_nome FROM public.contatos WHERE id = NEW.contato_id;

  _body := COALESCE(_contato_nome, 'Cliente') || ' agendado para ' || _quando;

  PERFORM public.fn_send_push(
    _ids,
    'Novo agendamento — ' || NEW.loja_nome,
    _body,
    '/agenda',
    'ag_novo_' || NEW.id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_agendamento_novo ON public.agendamentos;
CREATE TRIGGER trg_push_agendamento_novo
AFTER INSERT ON public.agendamentos
FOR EACH ROW
EXECUTE FUNCTION public.trg_push_agendamento_novo();
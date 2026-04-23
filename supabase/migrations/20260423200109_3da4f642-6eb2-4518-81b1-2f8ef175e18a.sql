CREATE OR REPLACE FUNCTION public.trg_push_nova_mensagem_interna()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _autor_nome text;
  _preview text;
begin
  if new.conversa_id like 'ponte_%' or new.conversa_id like 'demanda_%' then
    return new;
  end if;
  if new.destinatario_id is null or new.destinatario_id = new.remetente_id then
    return new;
  end if;

  select nome into _autor_nome from public.profiles where id = new.remetente_id;
  _preview := left(coalesce(new.conteudo, ''), 80);

  perform public.fn_send_push(
    array[new.destinatario_id],
    coalesce(_autor_nome, 'Nova mensagem'),
    _preview,
    '/conversas/' || new.remetente_id::text,
    'msg_' || new.conversa_id
  );
  return new;
end;
$function$;
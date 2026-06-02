CREATE OR REPLACE FUNCTION public.trg_push_nova_notificacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _ids uuid[];
  _url text := '/notificacoes';
  _tag text := 'notif_' || new.id::text;
begin
  if new.usuario_id is not null then
    _ids := array[new.usuario_id];
  elsif new.setor_id is not null then
    select array_agg(id) into _ids
    from public.profiles
    where setor_id = new.setor_id and ativo = true;
  end if;

  if _ids is null or array_length(_ids,1) is null then
    return new;
  end if;

  -- URL e tag específicas por tipo
  if new.tipo in ('atendimento_humano', 'atendimento_inbound') and new.referencia_id is not null then
    _url := '/crm/conversas?open=' || new.referencia_id::text;
    _tag := 'at_' || new.referencia_id::text;
  end if;

  perform public.fn_send_push(
    _ids,
    coalesce(new.titulo, 'Notificação'),
    left(coalesce(new.mensagem, ''), 120),
    _url,
    _tag
  );
  return new;
end;
$function$;
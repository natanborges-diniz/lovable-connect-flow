create extension if not exists pg_net with schema extensions;

create or replace function public.fn_send_push(
  _user_ids uuid[], _title text, _body text, _url text default '/', _tag text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  _supabase_url text;
  _service_key  text;
begin
  if _user_ids is null or array_length(_user_ids, 1) is null then return; end if;

  begin
    select decrypted_secret into _supabase_url from vault.decrypted_secrets where name='SUPABASE_URL' limit 1;
    select decrypted_secret into _service_key from vault.decrypted_secrets where name='SUPABASE_SERVICE_ROLE_KEY' limit 1;
  exception when others then
    _supabase_url := null; _service_key := null;
  end;

  if _supabase_url is null then _supabase_url := 'https://kvggebtnqmxydtwaumqz.supabase.co'; end if;

  if _service_key is null then
    raise log '[fn_send_push] missing SUPABASE_SERVICE_ROLE_KEY in vault';
    return;
  end if;

  perform net.http_post(
    url := _supabase_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _service_key
    ),
    body := jsonb_build_object(
      'user_ids', to_jsonb(_user_ids),
      'title', _title,
      'body', _body,
      'url', _url,
      'tag', _tag
    )
  );
end;
$$;

-- Trigger 1: nova mensagem interna (chat 1:1) → notifica destinatário
create or replace function public.trg_push_nova_mensagem_interna()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    '/mensagens?conversa=' || new.conversa_id,
    'msg_' || new.conversa_id
  );
  return new;
end;
$$;

drop trigger if exists trg_push_nova_mensagem on public.mensagens_internas;
create trigger trg_push_nova_mensagem
after insert on public.mensagens_internas
for each row execute function public.trg_push_nova_mensagem_interna();

-- Trigger 2: resposta da loja na demanda → notifica solicitante (operador)
create or replace function public.trg_push_demanda_loja_resposta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _solicitante uuid;
  _protocolo text;
  _preview text;
begin
  if new.direcao not in ('loja_to_operador', 'inbound') then
    return new;
  end if;

  select solicitante_id, protocolo into _solicitante, _protocolo
  from public.demandas_loja where id = new.demanda_id;

  if _solicitante is null then return new; end if;

  _preview := left(coalesce(new.conteudo, '[anexo]'), 80);

  perform public.fn_send_push(
    array[_solicitante],
    'Resposta da loja' || coalesce(' #' || _protocolo, ''),
    _preview,
    '/atendimentos?demanda=' || new.demanda_id,
    'demanda_' || new.demanda_id
  );
  return new;
end;
$$;

drop trigger if exists trg_push_demanda_resposta on public.demanda_mensagens;
create trigger trg_push_demanda_resposta
after insert on public.demanda_mensagens
for each row execute function public.trg_push_demanda_loja_resposta();

-- Trigger 3: nova notificação in-app → push (usuário direto OU broadcast por setor)
create or replace function public.trg_push_nova_notificacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _ids uuid[];
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

  perform public.fn_send_push(
    _ids,
    coalesce(new.titulo, 'Notificação'),
    left(coalesce(new.mensagem, ''), 120),
    '/notificacoes',
    'notif_' || new.id::text
  );
  return new;
end;
$$;

drop trigger if exists trg_push_nova_notificacao on public.notificacoes;
create trigger trg_push_nova_notificacao
after insert on public.notificacoes
for each row execute function public.trg_push_nova_notificacao();
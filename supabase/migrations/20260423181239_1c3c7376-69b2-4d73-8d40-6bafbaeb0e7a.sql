-- Tabela de config interna (só acessível via SECURITY DEFINER)
CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Sem nenhuma policy: ninguém acessa via PostgREST/anon/authenticated.
-- Só funções SECURITY DEFINER conseguem ler.

-- Atualiza fn_send_push para ler de public.app_config (vault está vazio neste projeto)
CREATE OR REPLACE FUNCTION public.fn_send_push(
  _user_ids uuid[],
  _title text,
  _body text,
  _url text DEFAULT '/',
  _tag text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
declare
  _supabase_url text;
  _service_key  text;
begin
  if _user_ids is null or array_length(_user_ids, 1) is null then return; end if;

  select value into _supabase_url from public.app_config where key='SUPABASE_URL' limit 1;
  select value into _service_key from public.app_config where key='SUPABASE_SERVICE_ROLE_KEY' limit 1;

  if _supabase_url is null then
    _supabase_url := 'https://kvggebtnqmxydtwaumqz.supabase.co';
  end if;

  if _service_key is null then
    raise log '[fn_send_push] missing SUPABASE_SERVICE_ROLE_KEY in app_config';
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
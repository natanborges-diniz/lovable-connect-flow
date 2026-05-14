create or replace function public.next_contato_anonimo()
returns bigint
language sql
security definer
set search_path = public
as $$
  select nextval('public.contatos_anonimo_seq');
$$;
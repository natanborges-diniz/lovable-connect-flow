alter table public.mensagens_internas
  add column if not exists anexo_url text,
  add column if not exists anexo_tipo text;

insert into storage.buckets (id, name, public)
values ('mensagens-anexos', 'mensagens-anexos', true)
on conflict (id) do nothing;

create policy "Anexos: leitura pública"
on storage.objects for select to public
using (bucket_id = 'mensagens-anexos');

create policy "Anexos: upload do próprio usuário"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'mensagens-anexos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Anexos: update do próprio usuário"
on storage.objects for update to authenticated
using (
  bucket_id = 'mensagens-anexos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Anexos: delete do próprio usuário"
on storage.objects for delete to authenticated
using (
  bucket_id = 'mensagens-anexos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
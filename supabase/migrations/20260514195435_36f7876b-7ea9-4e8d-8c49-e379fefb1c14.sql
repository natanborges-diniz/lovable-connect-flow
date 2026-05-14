-- Tabela lojas_cidades: catálogo cidade→loja para o ai-triage
create table public.lojas_cidades (
  id uuid primary key default gen_random_uuid(),
  cidade text not null,
  loja_id text not null,
  loja_nome text not null,
  regiao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.lojas_cidades enable row level security;

create policy "Leitura autenticada lojas_cidades"
  on public.lojas_cidades for select
  to authenticated
  using (true);

create policy "Admin gerencia lojas_cidades"
  on public.lojas_cidades for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "Service role full lojas_cidades"
  on public.lojas_cidades for all
  to service_role
  using (true)
  with check (true);

create index idx_lojas_cidades_cidade_ativo on public.lojas_cidades(cidade) where ativo;

-- Seed inicial a partir de CIDADE_TO_LOJAS (ai-triage/index.ts linhas 115-120)
insert into public.lojas_cidades (cidade, loja_id, loja_nome, regiao) values
  ('osasco', 'diniz-antonio-agu',     'DINIZ ANTONIO AGU',     'osasco'),
  ('osasco', 'diniz-primitiva-i',     'DINIZ PRIMITIVA I',     'osasco'),
  ('osasco', 'diniz-primitiva-ii',    'DINIZ PRIMITIVA II',    'osasco'),
  ('osasco', 'diniz-sto-antonio',     'DINIZ STO ANTONIO',     'osasco'),
  ('osasco', 'diniz-super-shopping',  'DINIZ SUPER SHOPPING',  'osasco'),
  ('osasco', 'diniz-uniao',           'DINIZ UNIÃO',           'osasco'),
  ('carapicuiba', 'diniz-carapicuiba','DINIZ CARAPICUIBA',     'carapicuiba'),
  ('itapevi', 'diniz-itapevi',        'DINIZ ITAPEVI',         'itapevi'),
  ('barueri', 'diniz-barueri',        'DINIZ BARUERI',         'barueri');
-- Mercados: uma linha por loja física, identificada pelo CNPJ completo (os 8
-- primeiros dígitos são a rede). A nota se liga à loja pelo store_cnpj que já tem.
-- Os números (notas, usuários, total) são calculados na consulta, não guardados.
create table app.stores (
  id           integer generated always as identity primary key,
  cnpj         char(14) not null unique check (cnpj ~ '^[0-9]{14}$'),
  cnpj_root    char(8) generated always as (left(cnpj, 8)) stored,
  name         text not null check (char_length(name) between 1 and 150),
  legal_name   text check (char_length(legal_name) <= 200),
  address      text check (char_length(address) <= 300),
  district     text check (char_length(district) <= 100),
  postal_code  text check (postal_code ~ '^[0-9]{8}$'),
  city         text check (char_length(city) <= 100),
  state        text check (char_length(state) <= 40),
  country      text not null default 'BR' check (char_length(country) <= 60),
  latitude     double precision check (latitude between -90 and 90),
  longitude    double precision check (longitude between -180 and 180),
  -- quando o preenchimento automático (CNPJ e coordenadas) rodou; null = ainda não
  enriched_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index stores_cnpj_root_idx on app.stores (cnpj_root);
create index receipts_store_cnpj_idx on app.receipts (store_cnpj);

-- As lojas das notas que já existem: nome mais frequente, endereço mais recente.
insert into app.stores (cnpj, name, address)
select store_cnpj,
       left(coalesce(mode() within group (order by nullif(trim(store_name), '')),
                     'Mercado ' || store_cnpj), 150),
       left((array_agg(store_address order by created_at desc, id desc)
               filter (where store_address is not null))[1], 300)
  from app.receipts
 where store_cnpj ~ '^[0-9]{14}$'
 group by store_cnpj;

-- Nota com CNPJ que ainda não tem loja (nova ou corrigida na revisão) cria a loja.
-- No banco, e não no app: vale para todo caminho que grava nota, inclusive código
-- anterior a esta migration.
create function app.ensure_store() returns trigger language plpgsql as $$
begin
  if new.store_cnpj ~ '^[0-9]{14}$' then
    insert into app.stores (cnpj, name, address)
    values (new.store_cnpj,
            -- cortado no limite da coluna: texto longo da leitura não pode
            -- impedir de gravar a nota
            left(coalesce(nullif(trim(new.store_name), ''), 'Mercado ' || new.store_cnpj), 150),
            left(new.store_address, 300))
    on conflict (cnpj) do nothing;
  end if;
  return new;
end
$$;
create trigger receipts_ensure_store
  after insert or update of store_cnpj on app.receipts
  for each row execute function app.ensure_store();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on app.stores from anon, authenticated;
  end if;
end
$$;

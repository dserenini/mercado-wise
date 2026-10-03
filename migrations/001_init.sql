-- Schema próprio do app, separado do `public` (onde está o legado do Supabase).
-- O Supabase só publica na API automática os schemas configurados (public); além
-- disso, o acesso dos papéis da API é revogado no fim deste arquivo.
-- Dinheiro sempre em centavos inteiros. Quantidade e embalagem em double precision.

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Memória: produtos confirmados pelo usuário e os apelidos que levam até eles.
-- ---------------------------------------------------------------------------

create table app.products (
  id            integer generated always as identity primary key,
  ean           text,                     -- GTIN do fabricante; nunca código de balança (prefixo 2)
  product       text not null,
  brand         text,
  variant       text,
  package_size  double precision,
  package_unit  text check (package_unit in ('g', 'kg', 'ml', 'l', 'un')),
  category      text not null,
  source        text not null,            -- 'review' | 'ground-truth' | 'legacy'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Com EAN, o EAN identifica o produto. Sem EAN (hortifruti, açougue), os campos.
create unique index products_ean_key on app.products (ean) where ean is not null;
create unique index products_fields_key on app.products
  (product, brand, variant, package_size, package_unit) nulls not distinct
  where ean is null;

-- Como cada mercado escreve o produto: (raiz do CNPJ, descrição crua) → produto.
create table app.product_aliases (
  id               integer generated always as identity primary key,
  product_id       integer not null references app.products (id) on delete cascade,
  store_cnpj_root  char(8) not null,      -- 8 primeiros dígitos: a rede, não a loja
  raw_description  text not null,
  store_code       text,                  -- código interno (balança) quando houver
  source           text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index product_aliases_description_key
  on app.product_aliases (store_cnpj_root, raw_description);
create index product_aliases_code_idx
  on app.product_aliases (store_cnpj_root, store_code) where store_code is not null;

-- ---------------------------------------------------------------------------
-- Notas
-- ---------------------------------------------------------------------------

create table app.receipts (
  id                    integer generated always as identity primary key,
  status                text not null default 'draft' check (status in ('draft', 'confirmed')),
  source                text not null default 'photo',   -- 'photo' | 'legacy'
  store_name            text,
  store_cnpj            text,
  store_address         text,
  access_key            text,
  purchase_date         date,
  purchase_time         time,
  items_count           integer,
  gross_total_cents     integer,
  discount_total_cents  integer,
  total_cents           integer,
  payment_method        text,
  image_path            text,
  traffic_light         text check (traffic_light in ('green', 'yellow', 'red')),
  created_at            timestamptz not null default now(),
  confirmed_at          timestamptz
);

-- A chave de acesso é única por nota fiscal: base da detecção de duplicata.
create unique index receipts_access_key_key on app.receipts (access_key)
  where access_key is not null;

create table app.receipt_items (
  id                     integer generated always as identity primary key,
  receipt_id             integer not null references app.receipts (id) on delete cascade,
  position               integer not null,
  -- leitura (o que está impresso)
  raw_description        text,
  ean                    text,
  store_code             text,
  quantity               double precision,
  unit                   text,
  unit_price_cents       integer,
  total_price_cents      integer,
  discount_cents         integer,
  -- interpretação
  product                text,
  brand                  text,
  variant                text,
  package_size           double precision,
  package_unit           text,
  category               text,
  confidence             text,
  interpretation_source  text,            -- 'memory' | 'ai' | 'user'
  product_id             integer references app.products (id),
  -- qualidade
  check_status           text check (check_status in ('ok', 'warning', 'error')),
  check_problems         jsonb not null default '[]',
  edited_by_user         boolean not null default false,
  unique (receipt_id, position)
);

-- Saída crua de cada chamada à IA: reprocessar, medir custo, comparar com o confirmado.
create table app.extractions (
  id              integer generated always as identity primary key,
  receipt_id      integer not null references app.receipts (id) on delete cascade,
  stage           text not null check (stage in ('read', 'interpret')),
  model           text not null,
  prompt_version  text not null,
  payload         jsonb not null,
  input_tokens    integer,
  output_tokens   integer,
  latency_ms      integer,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Só o servidor (dono do banco) acessa o schema. Os papéis da API do Supabase
-- (anon, authenticated) não existem fora dele, por isso o `if exists`.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema app from anon, authenticated;
    revoke all on all tables in schema app from anon, authenticated;
  end if;
end
$$;

-- Consultas de EAN no Open Food Facts, guardadas para não perguntar de novo.
-- found = false também fica guardado (o produto não está lá); erro de rede não.
create table app.ean_lookups (
  ean           text primary key,
  found         boolean not null,
  brand         text,
  product_name  text,
  quantity      text,
  fetched_at    timestamptz not null default now()
);

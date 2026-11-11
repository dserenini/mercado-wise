-- Nota pelo QR Code. Por nota: o endereço do QR, a chave de acesso dele (exata, sem
-- erro de leitura) e, quando a pessoa colou, o texto da página oficial da SEFAZ.
-- - com page_text: a leitura usa o texto da página, não a foto;
-- - sem page_text (QR lido, mas foi pela foto): a chave do QR corrige a da leitura,
--   e o CNPJ vem de dentro dela.
create table app.receipt_sources (
  receipt_id  integer primary key references app.receipts (id) on delete cascade,
  qr_url      text not null check (char_length(qr_url) <= 2000),
  access_key  char(44) not null check (access_key ~ '^[0-9]{44}$'),
  page_text   text check (char_length(page_text) <= 100000),
  created_at  timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on app.receipt_sources from anon, authenticated;
  end if;
end
$$;

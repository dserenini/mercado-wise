-- Fotos de perto da mesma nota (nota comprida: uma foto geral + fotos dos itens).
-- A foto geral continua em app.receipt_images; aqui ficam as demais, em ordem.
create table app.receipt_photos (
  receipt_id  integer not null references app.receipts (id) on delete cascade,
  position    integer not null check (position >= 1),
  media_type  text not null,
  width       integer not null,
  height      integer not null,
  data        bytea not null,
  created_at  timestamptz not null default now(),
  primary key (receipt_id, position)
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on app.receipt_photos from anon, authenticated;
  end if;
end
$$;

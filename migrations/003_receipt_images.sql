-- Foto da nota (já reduzida, JPEG ~300 KB) guardada no próprio Postgres, em tabela
-- separada para não pesar nas consultas de notas. Se crescer, migra para o Storage.

create table app.receipt_images (
  receipt_id  integer primary key references app.receipts (id) on delete cascade,
  media_type  text not null,
  width       integer not null,
  height      integer not null,
  data        bytea not null,
  created_at  timestamptz not null default now()
);

alter table app.receipts drop column image_path;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on app.receipt_images from anon, authenticated;
  end if;
end
$$;

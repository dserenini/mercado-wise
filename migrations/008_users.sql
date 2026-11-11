-- Usuários, fase inicial: login e senha; todo mundo vê e edita todas as notas, mas
-- cada nota tem dono. Usuários novos: `npm run add-user -- <nome>`.
create table app.users (
  id             integer generated always as identity primary key,
  username       text not null unique check (username ~ '^[a-z0-9._-]{2,32}$'),
  -- null: entra com a senha única de antes (APP_PASSWORD_HASH). É o caso do danilo,
  -- o primeiro usuário: a senha dele continua a de sempre, sem hash no repositório.
  password_hash  text check (password_hash is null or password_hash like 'scrypt:%'),
  created_at     timestamptz not null default now()
);

insert into app.users (username) values ('danilo');

-- Toda nota existente é do danilo. O padrão da coluna também: o código anterior a
-- esta migration (ainda no ar até o deploy) continua criando notas sem dono
-- explícito, e elas vão para ele em vez de quebrar.
alter table app.receipts add column user_id integer references app.users (id);
update app.receipts
   set user_id = (select id from app.users where username = 'danilo');
do $$
begin
  execute format(
    'alter table app.receipts alter column user_id set default %s',
    (select id from app.users where username = 'danilo'));
end
$$;
alter table app.receipts alter column user_id set not null;
create index receipts_user_id_idx on app.receipts (user_id);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on app.users from anon, authenticated;
  end if;
end
$$;

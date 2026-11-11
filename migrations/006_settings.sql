-- Configurações editáveis pela tela /settings (qual IA usar, chaves, modelos).
-- Chaves de API ficam criptografadas (AES-GCM, chave derivada do SESSION_SECRET).
create table app.settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on app.settings from anon, authenticated;
  end if;
end
$$;

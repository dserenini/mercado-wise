-- A mesma nota lida duas vezes pode variar na pontuação ou no "kg" do fim
-- ("PAO BAG.MIN.ASS." × "PAO BAG.MIN.ASS", "ALCAT.TE.C.PREM." × "ALCAT.TE.C.PREM.kg").
-- O apelido passa a ser casado por uma chave normalizada: maiúsculas, tudo que não é
-- letra ou número vira espaço, e a unidade de peso no fim (KG/K) é ignorada.

create function app.description_key(raw text) returns text
language sql immutable
as $$
  select nullif(
    regexp_replace(btrim(regexp_replace(upper(raw), '[^A-Z0-9]+', ' ', 'g')), ' (KG|K)$', ''),
    ''
  )
$$;

alter table app.product_aliases
  add column description_key text generated always as (app.description_key(raw_description)) stored;

-- Apelidos que passam a ter a mesma chave: fica o mais recente.
delete from app.product_aliases a
 using app.product_aliases b
 where a.store_cnpj_root = b.store_cnpj_root
   and a.description_key = b.description_key
   and a.id < b.id;

drop index app.product_aliases_description_key;
create unique index product_aliases_description_key
  on app.product_aliases (store_cnpj_root, description_key);

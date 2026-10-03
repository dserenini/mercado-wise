-- Correção: o driver postgres.js, ao ver um parâmetro do tipo jsonb, serializa o
-- valor de novo; como o repositório já mandava texto JSON, as linhas gravaram uma
-- string JSON ("[]") em vez do array. O repositório agora manda `$n::text::jsonb`.
-- Aqui, as linhas já gravadas voltam a ser JSON de verdade.

update app.receipt_items
   set check_problems = (check_problems #>> '{}')::jsonb
 where jsonb_typeof(check_problems) = 'string';

update app.extractions
   set payload = (payload #>> '{}')::jsonb
 where jsonb_typeof(payload) = 'string';

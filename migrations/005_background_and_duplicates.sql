-- Envio em lote: a nota nasce com a foto e status 'processing'; a leitura roda em
-- segundo plano e termina em 'draft', 'duplicate' (provável repetida) ou 'failed'.

alter table app.receipts drop constraint receipts_status_check;
alter table app.receipts add constraint receipts_status_check
  check (status in ('processing', 'failed', 'draft', 'duplicate', 'confirmed'));

alter table app.receipts
  -- quando a leitura começou (null = esperando a vez); serve para limitar quantas
  -- leituras rodam ao mesmo tempo e para achar leitura que travou
  add column read_started_at  timestamptz,
  -- por que falhou, para mostrar na lista
  add column error            text,
  -- nota já cadastrada de que esta parece ser cópia, e por quê
  add column duplicate_of     integer references app.receipts (id) on delete set null,
  add column duplicate_reason text;

-- Impressão digital da foto (dHash, 64 dígitos hex): foto repetida é recusada antes
-- de gastar a leitura.
alter table app.receipt_images add column hash text;

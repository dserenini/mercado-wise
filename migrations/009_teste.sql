-- teste do check: NÃO MERGEAR
drop table app.receipt_items;
alter table app.receipts drop column user_id;

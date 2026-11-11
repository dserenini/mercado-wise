import type { Db } from "./client.js";

/** Consultas leves nas tabelas do app: contam como uso do banco para o Supabase. */
export async function keepAlive(db: Db): Promise<void> {
  await db.query("select count(*) from app.receipts");
  await db.query("select count(*) from app.receipt_items");
  await db.query("select count(*) from app.products");
}

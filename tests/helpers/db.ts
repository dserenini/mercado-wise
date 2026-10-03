import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Db } from "../../src/db/client.js";
import { migrate } from "../../src/db/migrate.js";

function wrap(pg: PGlite | Transaction, root: PGlite | null): Db {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pg.query<T>(sql, params)).rows;
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (!root)
        throw new Error("Transação dentro de transação não é suportada");
      return root.transaction((tx) => fn(wrap(tx, null)));
    },
    async close() {
      await root?.close();
    },
  };
}

/** Postgres de verdade, em memória, já com as migrations aplicadas. */
export async function testDb(): Promise<Db> {
  const pg = new PGlite();
  const db = wrap(pg, pg);
  await migrate(db);
  return db;
}

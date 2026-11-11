import {
  PGlite,
  type PGliteInterface,
  type Transaction,
} from "@electric-sql/pglite";
import type { Db } from "../../src/db/client.js";
import { migrate } from "../../src/db/migrate.js";

function wrap(
  pg: PGliteInterface | Transaction,
  root: PGliteInterface | null,
): Db {
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

// Subir o PGlite e migrar custa ~0,5 s; clonar um banco já migrado, ~0,1 s.
// O modelo é criado uma vez por arquivo de teste e nunca é entregue a um teste.
let template: Promise<PGlite> | undefined;

async function migratedTemplate(): Promise<PGlite> {
  const pg = new PGlite();
  await migrate(wrap(pg, pg));
  return pg;
}

/** Postgres em memória sem nenhuma migration (para testar uma migration). */
export async function emptyDb(): Promise<Db> {
  const pg = new PGlite();
  return wrap(pg, pg);
}

/** Postgres de verdade, em memória, já com as migrations aplicadas. */
export async function testDb(): Promise<Db> {
  template ??= migratedTemplate();
  const pg = await (await template).clone();
  return wrap(pg, pg);
}

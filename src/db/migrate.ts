import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "./client.js";

export const MIGRATIONS_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "migrations",
);

/**
 * Aplica, em ordem, os arquivos `NNN_nome.sql` de migrations/ que ainda não foram
 * aplicados. Cada arquivo roda numa transação: ou entra inteiro, ou não entra.
 * Devolve os nomes aplicados agora.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`
    create schema if not exists app;
    create table if not exists app.schema_migrations (
      name        text primary key,
      applied_at  timestamptz not null default now()
    );
  `);

  const done = new Set(
    (
      await db.query<{ name: string }>("select name from app.schema_migrations")
    ).map((r) => r.name),
  );
  const files = (await readdir(dir))
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into app.schema_migrations (name) values ($1)", [
        file,
      ]);
    });
    applied.push(file);
  }
  return applied;
}

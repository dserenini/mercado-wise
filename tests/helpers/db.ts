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

// Subir o PGlite e migrar custa ~0,5 s; clonar um banco migrado, ~0,1 s; voltar
// um banco ao estado de recém-migrado (truncate + dados das migrations), ~10 ms.
// Por isso cada arquivo de teste migra um modelo uma vez e usa um único banco,
// zerado antes de cada teste. O modelo nunca é entregue a um teste.
let template: Promise<PGlite> | undefined;
let shared: Promise<{ pg: PGliteInterface; reset: string }> | undefined;

function migratedTemplate(): Promise<PGlite> {
  template ??= (async () => {
    const pg = new PGlite();
    await migrate(wrap(pg, pg));
    return pg;
  })();
  return template;
}

/**
 * SQL que volta o banco ao estado de recém-migrado: esvazia as tabelas do schema
 * `app`, recoloca as linhas que as migrations inseriram e volta os contadores de id.
 */
async function resetSql(db: Db): Promise<string> {
  const tables = (
    await db.query<{ t: string }>(
      `select format('%I.%I', table_schema, table_name) t
         from information_schema.tables
        where table_schema = 'app' and table_type = 'BASE TABLE'
          and table_name <> 'schema_migrations'`,
    )
  ).map((r) => r.t);
  const sql = [`truncate ${tables.join(", ")}`];
  // Sem checar chaves estrangeiras enquanto recoloca: a ordem das tabelas não importa.
  sql.push("set session_replication_role = replica");
  for (const t of tables) {
    const [{ rows } = { rows: null }] = await db.query<{
      rows: unknown[] | null;
    }>(`select json_agg(x) "rows" from ${t} x`);
    if (!rows) continue;
    const [{ cols } = { cols: "" }] = await db.query<{ cols: string }>(
      `select string_agg(quote_ident(column_name), ', ' order by ordinal_position) cols
         from information_schema.columns
        where format('%I.%I', table_schema, table_name) = $1
          and is_generated = 'NEVER'`,
      [t],
    );
    const json = JSON.stringify(rows).replaceAll("'", "''");
    sql.push(
      `insert into ${t} (${cols}) overriding system value
       select ${cols} from json_populate_recordset(null::${t}, '${json}')`,
    );
  }
  sql.push("set session_replication_role = default");
  const seqs = await db.query<{ s: string }>(
    `select format('select setval(%L, %s, %L)', format('%I.%I', schemaname, sequencename),
                   coalesce(last_value, start_value), last_value is not null) s
       from pg_sequences where schemaname = 'app'`,
  );
  sql.push(...seqs.map((r) => r.s));
  return `${sql.join(";\n")};`;
}

/**
 * Postgres de verdade, em memória, no estado de recém-migrado. É o mesmo banco
 * para todos os testes do arquivo, zerado a cada chamada; `close()` não fecha.
 * Teste que muda a estrutura do banco (drop, alter) usa `freshDb()`.
 */
export async function testDb(): Promise<Db> {
  shared ??= (async () => {
    const pg = await (await migratedTemplate()).clone();
    return { pg, reset: await resetSql(wrap(pg, pg)) };
  })();
  const { pg, reset } = await shared;
  await pg.exec(reset);
  return { ...wrap(pg, pg), close: async () => {} };
}

/** Cópia só deste teste: pode mudar a estrutura à vontade. Feche no fim. */
export async function freshDb(): Promise<Db> {
  const pg = await (await migratedTemplate()).clone();
  return wrap(pg, pg);
}

/** Postgres em memória sem nenhuma migration (para testar uma migration). */
export async function emptyDb(): Promise<Db> {
  const pg = new PGlite();
  return wrap(pg, pg);
}

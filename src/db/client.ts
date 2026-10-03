import postgres from "postgres";

/**
 * O pouco que o app precisa de um banco: consultas com parâmetros ($1, $2…),
 * scripts inteiros (migrations) e transações. Duas implementações: Postgres de
 * verdade (Supabase, abaixo) e PGlite em memória nos testes.
 */
export interface Db {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  /** Vários comandos de uma vez, sem parâmetros (migrations). */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type Sql = postgres.Sql | postgres.TransactionSql;

function wrap(sql: Sql, root: postgres.Sql | null): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(
        text,
        params as postgres.ParameterOrJSON<never>[],
      )) as T[];
    },
    async exec(text: string) {
      await sql.unsafe(text);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      if (!root)
        throw new Error("Transação dentro de transação não é suportada");
      return (await root.begin((tx) => fn(wrap(tx, null)))) as T;
    },
    async close() {
      await root?.end();
    },
  };
}

/**
 * Conexão com o Postgres do Supabase pelo "Transaction pooler" (porta 6543), que é
 * o indicado para funções serverless. Esse pooler não suporta prepared statements,
 * por isso `prepare: false`.
 */
export function createPostgresDb(url: string): Db {
  const sql = postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 20, // solta conexões paradas (a função na Vercel fica viva entre requisições)
    onnotice: () => {},
  });
  return wrap(sql, sql);
}

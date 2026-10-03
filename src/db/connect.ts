import { config } from "../config.js";
import { createPostgresDb, type Db } from "./client.js";

/** Conexão com o banco do app (Supabase), a partir do DATABASE_URL do .env. */
export function connect(): Db {
  if (!config.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL não configurada: cole no .env a connection string do Supabase " +
        '(botão "Connect" → Transaction pooler).',
    );
  }
  return createPostgresDb(config.DATABASE_URL);
}

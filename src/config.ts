import { existsSync } from "node:fs";
import { z } from "zod";

// Carrega o .env da raiz (se existir) para process.env — recurso nativo do Node 24.
if (existsSync(".env")) process.loadEnvFile(".env");

const Effort = z.enum(["low", "medium", "high", "xhigh", "max"]);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  // Opcional aqui: o SDK da Anthropic também acha a credencial sozinho
  // (ANTHROPIC_API_KEY ou perfil do `ant auth login`). Se faltar, o erro vem na chamada.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Postgres do Supabase pelo "Transaction pooler" (porta 6543). Opcional aqui para
  // que testes e scripts sem banco rodem sem ela; quem usa o banco exige (db/connect).
  DATABASE_URL: z.url().optional(),
  // Login do app (npm run setup-login gera as duas). Exigidas só pelo servidor web.
  APP_PASSWORD_HASH: z.string().startsWith("scrypt:").optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  READER_MODEL: z.string().default("claude-sonnet-5-5"),
  READER_EFFORT: Effort.default("high"),
  INTERPRETER_MODEL: z.string().default("claude-sonnet-5-5"),
  INTERPRETER_EFFORT: Effort.default("high"),
});

export type Config = z.infer<typeof EnvSchema>;

export const config: Config = EnvSchema.parse(process.env);

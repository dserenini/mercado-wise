import { existsSync } from "node:fs";
import { z } from "zod";

// Carrega o .env da raiz (se existir) para process.env — recurso nativo do Node 24.
if (existsSync(".env")) process.loadEnvFile(".env");

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  // Opcional aqui: o SDK da Anthropic também acha a credencial sozinho
  // (ANTHROPIC_API_KEY ou perfil do `ant auth login`). Se faltar, o erro vem na chamada.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  READER_MODEL: z.string().default("claude-sonnet-5-5"),
  READER_EFFORT: z
    .enum(["low", "medium", "high", "xhigh", "max"])
    .default("high"),
});

export type Config = z.infer<typeof EnvSchema>;

export const config: Config = EnvSchema.parse(process.env);

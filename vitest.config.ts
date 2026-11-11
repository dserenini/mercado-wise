import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Threads sobem mais rápido que processos (o padrão): ~25% a menos no total.
    pool: "threads",
    // Cada teste de banco sobe um Postgres em memória (PGlite) com as migrations;
    // com vários arquivos em paralelo, 5 s (o padrão) fica apertado.
    testTimeout: 20_000,
  },
});

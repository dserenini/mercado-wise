import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Cada teste de banco sobe um Postgres em memória (PGlite) com as migrations;
    // com vários arquivos em paralelo, 5 s (o padrão) fica apertado.
    testTimeout: 20_000,
  },
});

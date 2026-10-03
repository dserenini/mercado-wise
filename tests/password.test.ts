import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

describe("hashPassword / verifyPassword", () => {
  it("confere a senha certa e recusa a errada", async () => {
    const stored = await hashPassword("senha-de-teste");
    expect(stored).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(await verifyPassword("senha-de-teste", stored)).toBe(true);
    expect(await verifyPassword("senha-errada", stored)).toBe(false);
  });

  it("o mesmo texto gera hashes diferentes (sal aleatório)", async () => {
    expect(await hashPassword("x")).not.toBe(await hashPassword("x"));
  });

  it("recusa hash em formato desconhecido", async () => {
    expect(await verifyPassword("x", "texto-qualquer")).toBe(false);
  });
});

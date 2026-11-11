import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createApp } from "../src/create-app.js";
import type { Db } from "../src/db/client.js";
import {
  aiSettingsView,
  decrypt,
  encrypt,
  resolveAi,
} from "../src/services/ai-settings.js";
import { testDb } from "./helpers/db.js";

const SECRET = "s".repeat(32);
let db: Db;
beforeEach(async () => {
  db = await testDb();
});
afterEach(async () => {
  await db.close();
});

async function loggedIn() {
  const app = createApp({
    db,
    accept: async () => ({ kind: "queued", id: 1 }),
    process: async () => {},
    background: () => {},
    passwordHash: await hashPassword("senha-de-teste"),
    sessionSecret: SECRET,
  });
  const agent = request.agent(app);
  await agent.post("/login").type("form").send({ password: "senha-de-teste" });
  return agent;
}

describe("configurações da IA", () => {
  it("criptografa: só volta com o mesmo segredo", () => {
    const sealed = encrypt("sk-teste-1234", SECRET);
    expect(sealed).not.toContain("sk-teste");
    expect(decrypt(sealed, SECRET)).toBe("sk-teste-1234");
    expect(decrypt(sealed, "outro".repeat(8))).toBeNull();
  });

  it("salva pela tela, guarda a chave cifrada e passa a usar a escolha", async () => {
    const agent = await loggedIn();
    await agent
      .post("/settings")
      .type("form")
      .send({
        provider: "openai",
        openai_key: " sk-proj-abcd9876 ",
        openai_reader_model: "gpt-5.5",
        openai_interpreter_model: "gpt-5.5-mini",
        anthropic_reader_model: "modelo inválido!",
      })
      .expect(303)
      .expect("Location", "/settings?salvo=1");

    const rows = await db.query<{ value: string }>(
      "select value from app.settings where key = 'openai.key'",
    );
    expect(rows[0]?.value).not.toContain("sk-proj");

    expect(await resolveAi(db, SECRET)).toEqual({
      provider: "openai",
      apiKey: "sk-proj-abcd9876",
      readerModel: "gpt-5.5",
      interpreterModel: "gpt-5.5-mini",
    });
    // Nome de modelo inválido é descartado: volta ao padrão.
    const view = await aiSettingsView(db, SECRET);
    expect(view.providers.anthropic.readerModel).toMatch(/^claude-/);

    const page = await agent.get("/settings?salvo=1").expect(200);
    expect(page.text).toContain("…9876");
    expect(page.text).not.toContain("sk-proj-abcd9876");
  });

  it("chave vazia mantém a atual; marcar 'apagar' remove", async () => {
    const agent = await loggedIn();
    const send = (extra: Record<string, string>) =>
      agent
        .post("/settings")
        .type("form")
        .send({ provider: "openai", ...extra });
    await send({ openai_key: "sk-primeira" });
    await send({ openai_key: "" });
    expect((await resolveAi(db, SECRET)).apiKey).toBe("sk-primeira");
    await send({ openai_clear_key: "1" });
    const view = await aiSettingsView(db, SECRET);
    expect(view.providers.openai.keySource).not.toBe("saved");
  });

  it("recusa IA fora da lista", async () => {
    const agent = await loggedIn();
    await agent
      .post("/settings")
      .type("form")
      .send({ provider: "gemini" })
      .expect(400);
  });
});

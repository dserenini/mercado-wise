import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createApp } from "../src/create-app.js";
import type { Db } from "../src/db/client.js";
import { MIGRATIONS_DIR, migrate } from "../src/db/migrate.js";
import { saveDraft } from "../src/db/receipts-repo.js";
import { findUser, saveUser } from "../src/db/users-repo.js";
import { validateReceipt } from "../src/services/validators.js";
import { emptyDb, testDb } from "./helpers/db.js";
import { item, receipt } from "./helpers/receipt.js";

// A senha única de antes vale para o danilo (sem senha própria no banco); o rafael
// tem a dele.
const LEGACY = "senha-antiga";
const RAFAEL = "senha-do-rafael";
let legacyHash: string;
let rafaelHash: string;
let db: Db;
let acceptedBy: number[];

beforeAll(async () => {
  legacyHash = await hashPassword(LEGACY);
  rafaelHash = await hashPassword(RAFAEL);
});
beforeEach(async () => {
  db = await testDb();
  await saveUser(db, "rafael", rafaelHash);
  acceptedBy = [];
});
afterEach(async () => {
  await db.close();
});

function app() {
  return createApp({
    db,
    accept: async (_photo, userId) => {
      acceptedBy.push(userId);
      return { kind: "queued", id: 1 };
    },

    process: async () => {},
    background: () => {},
    passwordHash: legacyHash,
    sessionSecret: "x".repeat(32),
  });
}

async function login(username: string, password: string) {
  const agent = request.agent(app());
  await agent
    .post("/login")
    .type("form")
    .send({ username, password })
    .expect(303);
  return agent;
}

/** Nota sem dono explícito (como os scripts criam): fica com o dono padrão. */
async function draft(store: string) {
  const r = receipt({
    store: { name: store, cnpj: null, address: null },
    items: [item()],
  });
  return saveDraft(db, {
    receipt: r,
    validation: validateReceipt(r),
    interpreted: [null],
    calls: { read: null, interpret: null },
    image: null,
  });
}

describe("login com usuário", () => {
  it("danilo entra com a senha de antes; rafael com a dele", async () => {
    await login("danilo", LEGACY);
    await login("Rafael ", RAFAEL); // maiúscula e espaço não atrapalham
  });

  it("recusa senha errada, senha de outro usuário e usuário inexistente", async () => {
    const tries = [
      ["danilo", "errada"],
      ["rafael", LEGACY],
      ["ninguem", LEGACY],
    ];
    for (const [username, password] of tries) {
      const res = await request(app())
        .post("/login")
        .type("form")
        .send({ username, password })
        .expect(401);
      expect(res.text).toContain("Usuário ou senha incorretos");
    }
  });

  it("sessão de antes dos usuários (sem userId) volta para o login", async () => {
    // Cookie assinado com o formato antigo: { loggedIn: true }
    const res = await request(app()).get("/").expect(303);
    expect(res.headers.location).toBe("/login");
  });
});

describe("dono das notas", () => {
  it("cada um vê as suas por padrão; 'todas' mostra as de todos, com o dono", async () => {
    await draft("Mercado do Danilo");
    const rafael = await login("rafael", RAFAEL);

    const mine = await rafael.get("/").expect(200);
    expect(mine.text).toContain("Minhas notas");
    expect(mine.text).not.toContain("Mercado do Danilo");
    expect(mine.text).toContain("veja as notas de todos");

    const all = await rafael.get("/?quem=todas").expect(200);
    expect(all.text).toContain("Notas de todos");
    expect(all.text).toContain("Mercado do Danilo");
    expect(all.text).toContain("de danilo");

    const danilo = await login("danilo", LEGACY);
    expect((await danilo.get("/").expect(200)).text).toContain(
      "Mercado do Danilo",
    );
  });

  it("qualquer um abre a nota do outro, e a tela diz de quem é", async () => {
    const id = await draft("Mercado do Danilo");
    const rafael = await login("rafael", RAFAEL);
    const page = await rafael.get(`/receipts/${id}`).expect(200);
    expect(page.text).toMatch(/nota de\s*<strong>danilo<\/strong>/);
    const danilo = await login("danilo", LEGACY);
    expect((await danilo.get(`/receipts/${id}`)).text).toContain("sua nota");
  });

  it("foto enviada fica com quem enviou", async () => {
    const rafael = await login("rafael", RAFAEL);
    await rafael
      .post("/receipts")
      .attach("photo", Buffer.from("jpeg"), {
        filename: "n.jpg",
        contentType: "image/jpeg",
      })
      .expect(303);
    const user = await findUser(db, "rafael");
    expect(acceptedBy).toEqual([user?.id]);
  });
});

describe("migration 008", () => {
  it("notas que já existiam e notas do código antigo ficam com o danilo", async () => {
    const before = await mkdtemp(join(tmpdir(), "mw-mig-"));
    try {
      for (const f of await readdir(MIGRATIONS_DIR))
        if (f < "008") await cp(join(MIGRATIONS_DIR, f), join(before, f));
      const old = await emptyDb();
      await migrate(old, before);
      const insert =
        "insert into app.receipts (source, status) values ('photo', 'draft') returning id";
      const [existing] = await old.query<{ id: number }>(insert);

      await migrate(old);
      // Código anterior (sem user_id) ainda no ar depois da migration.
      const [later] = await old.query<{ id: number }>(insert);
      const owners = await old.query<{ username: string }>(
        `select u.username from app.receipts r join app.users u on u.id = r.user_id
          where r.id = any($1::int[])`,
        [[existing?.id, later?.id]],
      );
      expect(owners.map((o) => o.username)).toEqual(["danilo", "danilo"]);
      await old.close();
    } finally {
      await rm(before, { recursive: true });
    }
  });
});

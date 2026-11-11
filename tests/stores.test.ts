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
import { getStore, listStores } from "../src/db/stores-repo.js";
import { saveUser } from "../src/db/users-repo.js";
import {
  type CnpjInfo,
  enrichReceiptStore,
  enrichStore,
  type StoreLookup,
} from "../src/services/stores.js";
import { validateReceipt } from "../src/services/validators.js";
import { emptyDb, freshDb, testDb } from "./helpers/db.js";
import { item, receipt, VALID_CNPJ } from "./helpers/receipt.js";

const OTHER_CNPJ = "04641376057596";
let db: Db;
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword("senha");
});
beforeEach(async () => {
  db = await testDb();
});
afterEach(async () => {
  await db.close();
});

async function draft(
  store: { name: string | null; cnpj: string | null; address?: string | null },
  total = 10,
) {
  const r = receipt({
    store: { address: null, ...store },
    access_key: null,
    items: [item()],
    total,
  });
  return saveDraft(db, {
    receipt: r,
    validation: validateReceipt(r),
    interpreted: [null],
    calls: { read: null, interpret: null },
    image: null,
  });
}

const INFO: CnpjInfo = {
  legal_name: "DMA DISTRIBUIDORA S/A",
  street: "RUA FRANCISCO DESLANDES",
  number: "900",
  complement: "LOJA 108",
  district: "CRUZEIRO",
  postal_code: "30310530",
  city: "BELO HORIZONTE",
  state: "MG",
};

function fakeLookup(info: CnpjInfo | "not-found" | null = INFO) {
  const geocoded: unknown[] = [];
  const lookup: StoreLookup = {
    cnpj: async () => info,
    geocode: async (q) => {
      geocoded.push(q);
      return { latitude: -19.95, longitude: -43.93 };
    },
  };
  return { lookup, geocoded };
}

describe("loja nasce sozinha pelo CNPJ da nota", () => {
  it("cria na primeira nota, não muda nas seguintes, ignora nota sem CNPJ", async () => {
    await draft({ name: "EPA", cnpj: VALID_CNPJ, address: "Rua X, 1" });
    await draft({ name: "EPA PLUS", cnpj: VALID_CNPJ });
    await draft({ name: "Sem CNPJ", cnpj: null });
    const stores = await listStores(db);
    expect(stores).toHaveLength(1);
    expect(stores[0]).toMatchObject({
      cnpj: VALID_CNPJ,
      cnpj_root: VALID_CNPJ.slice(0, 8),
      name: "EPA",
      address: "Rua X, 1",
      receipts: 2,
    });
  });

  it("CNPJ corrigido na nota cria a loja nova; nome longo demais é cortado", async () => {
    const id = await draft({ name: "x".repeat(400), cnpj: null });
    await db.query("update app.receipts set store_cnpj = $1 where id = $2", [
      OTHER_CNPJ,
      id,
    ]);
    expect((await getStore(db, OTHER_CNPJ))?.name).toHaveLength(150);
  });
});

describe("números do mercado", () => {
  it("contam rascunhos e confirmadas, de usuários diferentes; repetidas e falhas não", async () => {
    const rafael = await saveUser(db, "rafael", passwordHash);
    expect(rafael).toBe(true);
    const a = await draft({ name: "EPA", cnpj: VALID_CNPJ }, 10);
    const b = await draft({ name: "EPA", cnpj: VALID_CNPJ }, 20);
    const dup = await draft({ name: "EPA", cnpj: VALID_CNPJ }, 99);
    const failed = await draft({ name: "EPA", cnpj: VALID_CNPJ }, 99);
    await db.query(
      `update app.receipts set status = 'confirmed',
              user_id = (select id from app.users where username = 'rafael')
        where id = $1`,
      [b],
    );
    await db.query(
      "update app.receipts set status = 'duplicate' where id = $1",
      [dup],
    );
    await db.query("update app.receipts set status = 'failed' where id = $1", [
      failed,
    ]);
    await db.query(
      "update app.receipts set purchase_date = '2026-01-05' where id = $1",
      [a],
    );
    expect(await getStore(db, VALID_CNPJ)).toMatchObject({
      receipts: 2,
      users: 2,
      total_cents: 3000,
      first_purchase: "2025-09-30", // data da nota de exemplo
      last_purchase: "2026-01-05",
    });
  });
});

describe("preenchimento automático", () => {
  it("completa os vazios pelo CNPJ e geocodifica pelo endereço da Receita", async () => {
    await draft({ name: "EPA", cnpj: VALID_CNPJ });
    const store = await getStore(db, VALID_CNPJ);
    const { lookup, geocoded } = fakeLookup();
    expect(store && (await enrichStore(db, store, lookup))).toBe(true);
    expect(await getStore(db, VALID_CNPJ)).toMatchObject({
      name: "EPA",
      legal_name: "DMA DISTRIBUIDORA S/A",
      address: "Rua Francisco Deslandes, 900 - Loja 108",
      district: "Cruzeiro",
      postal_code: "30310530",
      city: "Belo Horizonte",
      state: "MG",
      latitude: -19.95,
      longitude: -43.93,
    });
    expect(geocoded[0]).toMatchObject({
      street: "900 Rua Francisco Deslandes",
      city: "BELO HORIZONTE",
    });
    expect((await getStore(db, VALID_CNPJ))?.enriched_at).not.toBeNull();
  });

  it("nunca sobrescreve o que já está preenchido", async () => {
    await draft({ name: "EPA", cnpj: VALID_CNPJ, address: "Endereço da nota" });
    await db.query(
      "update app.stores set city = 'Contagem', latitude = 1, longitude = 2",
    );
    const store = await getStore(db, VALID_CNPJ);
    const { lookup, geocoded } = fakeLookup();
    if (store) await enrichStore(db, store, lookup);
    expect(await getStore(db, VALID_CNPJ)).toMatchObject({
      address: "Endereço da nota",
      city: "Contagem",
      latitude: 1,
      longitude: 2,
      state: "MG",
    });
    expect(geocoded).toEqual([]); // já tinha coordenadas
  });

  it("sem resposta: não marca como consultada; CNPJ sem cadastro: geocodifica o texto", async () => {
    await draft({ name: "EPA", cnpj: VALID_CNPJ, address: "Rua Y, 2" });
    const store = await getStore(db, VALID_CNPJ);
    if (!store) throw new Error("loja não criada");
    expect(await enrichStore(db, store, fakeLookup(null).lookup)).toBe(false);
    expect((await getStore(db, VALID_CNPJ))?.enriched_at).toBeNull();

    const { lookup, geocoded } = fakeLookup("not-found");
    expect(await enrichStore(db, store, lookup)).toBe(true);
    expect(geocoded).toEqual([{ text: "Rua Y, 2, Brasil" }]);
  });

  it("depois da leitura completa a loja da nota uma vez só", async () => {
    const id = await draft({ name: "EPA", cnpj: VALID_CNPJ });
    let calls = 0;
    const lookup: StoreLookup = {
      cnpj: async () => {
        calls++;
        return INFO;
      },
      geocode: async () => null,
    };
    await enrichReceiptStore(db, id, lookup);
    await enrichReceiptStore(db, id, lookup);
    expect(calls).toBe(1);
  });
});

describe("migration 009", () => {
  it("cria as lojas das notas existentes: nome mais frequente, endereço mais recente", async () => {
    const before = await mkdtemp(join(tmpdir(), "mw-mig-"));
    try {
      for (const f of await readdir(MIGRATIONS_DIR))
        if (f < "009") await cp(join(MIGRATIONS_DIR, f), join(before, f));
      const old = await emptyDb();
      await migrate(old, before);
      for (const [name, address] of [
        ["EPA PLUS", "antigo"],
        ["EPA", "meio"],
        ["EPA", "recente"],
      ])
        await old.query(
          `insert into app.receipts (source, status, store_name, store_cnpj, store_address)
           values ('photo', 'draft', $1, $2, $3)`,
          [name, VALID_CNPJ, address],
        );
      await migrate(old);
      expect(await getStore(old, VALID_CNPJ)).toMatchObject({
        name: "EPA",
        address: "recente",
        receipts: 3,
      });
      await old.close();
    } finally {
      await rm(before, { recursive: true });
    }
  });
});

describe("telas", () => {
  async function agent(lookup?: StoreLookup, on: Db = db) {
    const a = request.agent(
      createApp({
        db: on,
        accept: async () => ({ kind: "queued", id: 1 }),
        acceptPage: async () => ({ kind: "error" as const, message: "" }),

        process: async () => {},
        background: () => {},
        ...(lookup ? { storeLookup: lookup } : {}),
        passwordHash,
        sessionSecret: "x".repeat(32),
      }),
    );
    await a
      .post("/login")
      .type("form")
      .send({ username: "danilo", password: "senha" })
      .expect(303);
    return a;
  }

  it("lista, mostra, edita e recusa dado inválido", async () => {
    await draft({ name: "EPA", cnpj: VALID_CNPJ });
    const a = await agent();
    expect((await a.get("/stores").expect(200)).text).toContain("EPA");
    const page = await a.get(`/stores/${VALID_CNPJ}`).expect(200);
    expect(page.text).toContain("11.222.333/0001-81");

    await a
      .post(`/stores/${VALID_CNPJ}`)
      .type("form")
      .send({
        name: "EPA Plus",
        postal_code: "30310-530",
        city: "BH",
        latitude: "-19,95",
        longitude: "-43.9",
      })
      .expect(303);
    expect(await getStore(db, VALID_CNPJ)).toMatchObject({
      name: "EPA Plus",
      postal_code: "30310530",
      latitude: -19.95,
      country: "BR",
    });

    const bad = await a
      .post(`/stores/${VALID_CNPJ}`)
      .type("form")
      .send({ name: "", postal_code: "123", latitude: "200" })
      .expect(400);
    expect(bad.text).toContain("O nome é obrigatório");
    expect(bad.text).toContain("CEP");
    expect(bad.text).toContain("Latitude inválida");
    await a.get("/stores/123").expect(404);
  });

  it("botão completa pelo CNPJ (só com consulta configurada)", async () => {
    await draft({ name: "EPA", cnpj: VALID_CNPJ });
    const without = await agent();
    expect((await without.get(`/stores/${VALID_CNPJ}`)).text).not.toContain(
      "Completar campos vazios",
    );
    const a = await agent(fakeLookup().lookup);
    await a.post(`/stores/${VALID_CNPJ}/enrich`).expect(303);
    expect((await getStore(db, VALID_CNPJ))?.city).toBe("Belo Horizonte");
  });

  it("banco sem a migration 009: avisa em vez de quebrar", async () => {
    const old = await freshDb();
    await old.exec("drop table app.stores cascade");
    const a = await agent(undefined, old);
    const res = await a.get("/stores").expect(503);
    expect(res.text).toContain("npm run migrate");
    await old.close();
  });
});

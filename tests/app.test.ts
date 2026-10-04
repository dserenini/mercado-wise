import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createApp } from "../src/create-app.js";
import type { Db } from "../src/db/client.js";
import { createDbMemory } from "../src/db/memory.js";
import {
  getReceipt,
  rememberItem,
  saveDraft,
} from "../src/db/receipts-repo.js";
import type { IngestResult } from "../src/services/ingest.js";
import { validateReceipt } from "../src/services/validators.js";
import { testDb } from "./helpers/db.js";
import { item, receipt, VALID_CNPJ } from "./helpers/receipt.js";

const PASSWORD = "senha-de-teste";
let passwordHash: string;
let db: Db;
let ingestCalls: Buffer[];
let ingestResult: IngestResult;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});
beforeEach(async () => {
  db = await testDb();
  ingestCalls = [];
});
afterEach(async () => {
  await db.close();
});

function app() {
  return createApp({
    db,
    // Ingestão falsa: nenhum teste chama a IA.
    ingest: async (photo) => {
      ingestCalls.push(photo);
      return ingestResult;
    },
    passwordHash,
    sessionSecret: "x".repeat(32),
  });
}

async function loggedIn() {
  const agent = request.agent(app());
  await agent
    .post("/login")
    .type("form")
    .send({ password: PASSWORD })
    .expect(303);
  return agent;
}

async function draft(withImage = false) {
  const r = receipt({ items: [item()], total: 3.99 });
  return saveDraft(db, {
    receipt: r,
    validation: validateReceipt(r),
    interpreted: [null],
    calls: { read: null, interpret: null },
    image: withImage
      ? {
          data: Buffer.from("jpeg-falso"),
          mediaType: "image/jpeg",
          width: 1,
          height: 1,
        }
      : null,
  });
}

const reviewForm = {
  store_name: "SUPERMERCADO X",
  purchase_date: "2025-09-30",
  total: "3,99",
  payment_method: "Débito",
  "items[0][raw_description]": "AG TON SCHW ZERO 350",
  "items[0][ean]": "7894900360042",
  "items[0][quantity]": "1",
  "items[0][unit]": "UN",
  "items[0][unit_price]": "3,99",
  "items[0][total_price]": "3,99",
  "items[0][product]": "Água tônica",
  "items[0][brand]": "Schweppes",
  "items[0][variant]": "Zero",
  "items[0][package_size]": "350",
  "items[0][package_unit]": "ml",
  "items[0][category]": "Bebidas",
};

describe("login", () => {
  it("/health responde sem login", async () => {
    await request(app()).get("/health").expect(200, { status: "ok" });
  });

  it("sem login, manda para /login", async () => {
    const res = await request(app()).get("/").expect(303);
    expect(res.headers.location).toBe("/login");
  });

  it("senha errada não entra; certa entra", async () => {
    await request(app())
      .post("/login")
      .type("form")
      .send({ password: "nao" })
      .expect(401);
    const agent = await loggedIn();
    await agent.get("/").expect(200);
  });

  it("sair encerra a sessão", async () => {
    const agent = await loggedIn();
    await agent.post("/logout").expect(303);
    await agent.get("/").expect(303);
  });
});

describe("notas", () => {
  it("lista e abre a revisão do rascunho", async () => {
    const id = await draft();
    const agent = await loggedIn();

    const list = await agent.get("/").expect(200);
    expect(list.text).toContain(`/receipts/${id}`);
    expect(list.text).toContain("SUPERMERCADO X");

    const review = await agent.get(`/receipts/${id}`).expect(200);
    expect(review.text).toContain("AG TON SCHW ZERO 350");
    expect(review.text).toContain("Confirmar nota");
  });

  it("confirma a revisão: grava, marca como confirmada e ensina a memória", async () => {
    const id = await draft();
    const agent = await loggedIn();

    const res = await agent
      .post(`/receipts/${id}/confirm`)
      .type("form")
      .send(reviewForm);
    expect(res.status).toBe(303);

    const saved = await getReceipt(db, id);
    expect(saved?.receipt.status).toBe("confirmed");
    expect(saved?.items[0]).toMatchObject({
      product: "Água tônica",
      unit_price_cents: 399,
    });
    const remembered = await createDbMemory(db).find(item(), {
      name: null,
      cnpj: null,
    });
    expect(remembered?.variant).toBe("Zero");
  });

  it("rascunho aberto mostra o que foi confirmado depois em outra nota", async () => {
    const id = await draft(); // interpretado antes: sem produto
    // outra nota confirmou o mesmo EAN depois
    await rememberItem(
      db,
      {
        ...item(),
        product: "Água tônica",
        brand: "Schweppes",
        variant: "Zero",
        package_size: 350,
        package_unit: "ml",
        category: "Bebidas",
        confidence: "high",
      },
      null,
      "review",
    );
    const agent = await loggedIn();
    const res = await agent.get(`/receipts/${id}`).expect(200);
    expect(res.text).toContain("Água tônica · Schweppes · Zero");
    expect(res.text).toContain("AG TON SCHW ZERO 350 · memória");
    // só mostra: o banco continua com o rascunho original até a confirmação
    expect((await getReceipt(db, id))?.items[0]?.product).toBeNull();
  });

  it("formulário inválido volta para a revisão com os erros", async () => {
    const id = await draft();
    const agent = await loggedIn();
    const res = await agent
      .post(`/receipts/${id}/confirm`)
      .type("form")
      .send({ ...reviewForm, "items[0][product]": "", total: "abc" })
      .expect(400);
    expect(res.text).toContain("Item 1: informe o produto");
    expect((await getReceipt(db, id))?.receipt.status).toBe("draft");
  });

  it("serve a foto da nota", async () => {
    const agent = await loggedIn();
    await agent.get(`/receipts/${await draft()}/image`).expect(404);
    const res = await agent
      .get(`/receipts/${await draftWithOtherKey()}/image`)
      .expect(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
  });

  it("exclui a nota", async () => {
    const id = await draft();
    const agent = await loggedIn();
    await agent.post(`/receipts/${id}/delete`).expect(303);
    expect(await getReceipt(db, id)).toBeNull();
  });
});

describe("upload", () => {
  it("manda a foto para a ingestão e abre a revisão", async () => {
    ingestResult = { kind: "saved", id: 42 };
    const agent = await loggedIn();
    const res = await agent
      .post("/receipts")
      .attach("photo", Buffer.from("foto"), {
        filename: "nota.jpg",
        contentType: "image/jpeg",
      })
      .expect(303);
    expect(res.headers.location).toBe("/receipts/42");
    expect(ingestCalls.map((b) => b.toString())).toEqual(["foto"]);
  });

  it("avisa quando a nota já existe", async () => {
    ingestResult = { kind: "duplicate", id: 7, status: "confirmed" };
    const agent = await loggedIn();
    const res = await agent
      .post("/receipts")
      .attach("photo", Buffer.from("foto"), {
        filename: "nota.jpg",
        contentType: "image/jpeg",
      })
      .expect(409);
    expect(res.text).toContain("Nota já cadastrada");
    expect(res.text).toContain("/receipts/7");
  });

  it("recusa envio sem imagem", async () => {
    const agent = await loggedIn();
    await agent
      .post("/receipts")
      .attach("photo", Buffer.from("texto"), {
        filename: "a.txt",
        contentType: "text/plain",
      })
      .expect(400);
    expect(ingestCalls).toEqual([]);
  });
});

const tonica = {
  ...item(),
  product: "Água tônica",
  brand: "Schweppes",
  variant: "Zero",
  package_size: 350,
  package_unit: "ml" as const,
  category: "Bebidas" as const,
  confidence: "high" as const,
};

describe("sugestões", () => {
  it("descrição ilegível com EAN conhecido: sugere produto e descrição", async () => {
    await rememberItem(db, tonica, VALID_CNPJ, "review");
    const r = receipt({ items: [item({ raw_description: null })] });
    const id = await saveDraft(db, {
      receipt: r,
      validation: validateReceipt(r),
      interpreted: [null],
      calls: { read: null, interpret: null },
    });
    const agent = await loggedIn();
    const res = await agent.get(`/receipts/${id}`).expect(200);
    expect(res.text).toContain("Sugestão da memória pelo código");
    expect(res.text).toContain('value="AG TON SCHW ZERO 350"');
    expect(res.text).toContain("Água tônica · Schweppes · Zero");
  });

  it("autocompleta pela descrição ou pelo produto, sem acento", async () => {
    await rememberItem(db, tonica, VALID_CNPJ, "review");
    const agent = await loggedIn();
    const res = await agent
      .get("/suggest/items")
      .query({ q: "agua ton", cnpj: VALID_CNPJ })
      .expect(200);
    expect(res.body).toMatchObject([
      { raw_description: "AG TON SCHW ZERO 350", product: "Água tônica" },
    ]);
    const byCode = await agent
      .get("/suggest/code")
      .query({ ean: "7894900360042" })
      .expect(200);
    expect(byCode.body).toMatchObject({ product: "Água tônica" });
  });

  it("lista os mercados já confirmados no campo Mercado", async () => {
    const confirmed = await draftWithOtherKey();
    await db.query(
      "update app.receipts set status = 'confirmed', store_name = 'DMA DISTRIBUIDORA S/A' where id = $1",
      [confirmed],
    );
    const agent = await loggedIn();
    const res = await agent.get(`/receipts/${await draft()}`).expect(200);
    expect(res.text).toContain('<option value="DMA DISTRIBUIDORA S/A">');
  });

  it("sugestões exigem login", async () => {
    await request(app()).get("/suggest/items?q=agua").expect(303);
  });
});

// Segunda nota precisa de outra chave de acesso (a chave é única).
async function draftWithOtherKey() {
  const r = receipt({ items: [item()], total: 3.99, access_key: null });
  return saveDraft(db, {
    receipt: r,
    validation: validateReceipt(r),
    interpreted: [null],
    calls: { read: null, interpret: null },
    image: {
      data: Buffer.from("jpeg-falso"),
      mediaType: "image/jpeg",
      width: 1,
      height: 1,
    },
  });
}

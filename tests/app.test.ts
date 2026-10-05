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
import type { AcceptResult } from "../src/services/ingest.js";
import { validateReceipt } from "../src/services/validators.js";
import { testDb } from "./helpers/db.js";
import { item, receipt, VALID_CNPJ } from "./helpers/receipt.js";

const PASSWORD = "senha-de-teste";
let passwordHash: string;
let db: Db;
let accepted: Buffer[];
let acceptResult: AcceptResult;
let processed: number[];

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});
beforeEach(async () => {
  db = await testDb();
  accepted = [];
  processed = [];
});
afterEach(async () => {
  await db.close();
});

function app() {
  return createApp({
    db,
    // Envio falso: nenhum teste chama a IA.
    accept: async (photo) => {
      accepted.push(photo);
      return acceptResult;
    },
    process: async (id) => {
      processed.push(id);
    },
    background: () => {},
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
    expect(res.headers.location).toBe(`/?confirmada=${id}`);

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

  it("depois de confirmar, volta para a lista com os filtros e o aviso", async () => {
    const id = await draft();
    const agent = await loggedIn();
    await agent.get("/?status=draft&data_de=2025").expect(200);

    const first = await agent
      .post(`/receipts/${id}/confirm`)
      .type("form")
      .send(reviewForm)
      .expect(303);
    expect(first.headers.location).toBe(
      `/?status=draft&data_de=2025&confirmada=${id}`,
    );
    const list = await agent.get(String(first.headers.location)).expect(200);
    expect(list.text).toContain(`Nota #${id} confirmada`);

    // salvar de novo uma nota já confirmada é "corrigida"
    const again = await agent
      .post(`/receipts/${id}/confirm`)
      .type("form")
      .send(reviewForm)
      .expect(303);
    expect(again.headers.location).toContain(`corrigida=${id}`);
  });

  it("lista filtra pela URL e mostra o resumo", async () => {
    await draft();
    const agent = await loggedIn();
    const all = await agent.get("/").expect(200);
    expect(all.text).toContain("1 nota · <strong>R$ 3,99</strong>");
    const none = await agent.get("/?status=confirmed").expect(200);
    expect(none.text).toContain("Nenhuma nota com esses filtros");
    expect(none.text).toContain("data-filter-count> (1)<");
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
  const photo = (agent: Awaited<ReturnType<typeof loggedIn>>) =>
    agent.post("/receipts").attach("photo", Buffer.from("foto"), {
      filename: "nota.jpg",
      contentType: "image/jpeg",
    });

  it("aceita a foto, manda ler em segundo plano e responde JSON ao upload.js", async () => {
    acceptResult = { kind: "queued", id: 42 };
    const agent = await loggedIn();
    const res = await photo(agent)
      .set("Accept", "application/json")
      .expect(200);
    expect(res.body).toEqual({ results: [{ kind: "queued", id: 42 }] });
    expect(accepted.map((b) => b.toString())).toEqual(["foto"]);
    expect(processed).toEqual([42]);
  });

  it("sem JavaScript, volta para a lista", async () => {
    acceptResult = { kind: "queued", id: 42 };
    const agent = await loggedIn();
    const res = await photo(agent).expect(303);
    expect(res.headers.location).toBe("/");
  });

  it("foto repetida é recusada e não é lida", async () => {
    acceptResult = { kind: "same-photo", id: 7, status: "confirmed" };
    const agent = await loggedIn();
    const res = await photo(agent)
      .set("Accept", "application/json")
      .expect(200);
    expect(res.body.results[0]).toMatchObject({ kind: "same-photo", id: 7 });
    expect(processed).toEqual([]);
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
    expect(accepted).toEqual([]);
  });

  it("nota lendo mostra a tela de espera; falha permite tentar de novo", async () => {
    const id = await draft();
    const agent = await loggedIn();
    await db.query(
      "update app.receipts set status = 'processing' where id = $1",
      [id],
    );
    expect((await agent.get(`/receipts/${id}`).expect(200)).text).toContain(
      "Lendo a nota",
    );

    await db.query(
      "update app.receipts set status = 'failed', error = 'deu ruim' where id = $1",
      [id],
    );
    expect((await agent.get(`/receipts/${id}`).expect(200)).text).toContain(
      "deu ruim",
    );
    await agent.post(`/receipts/${id}/retry`).expect(303);
    expect(processed).toEqual([id]);
    expect((await getReceipt(db, id))?.receipt.status).toBe("processing");
  });

  it("possível repetida: aviso na revisão e 'não é repetida' volta a rascunho", async () => {
    const original = await draft();
    const copy = await draftWithOtherKey();
    await db.query(
      `update app.receipts set status = 'duplicate', duplicate_of = $2,
              duplicate_reason = '1 de 1 itens iguais' where id = $1`,
      [copy, original],
    );
    const agent = await loggedIn();
    const list = await agent.get("/").expect(200);
    expect(list.text).toContain(`repetida? → #${original}`);
    const review = await agent.get(`/receipts/${copy}`).expect(200);
    expect(review.text).toContain("Possível nota repetida");
    expect(review.text).toContain("1 de 1 itens iguais");
    await agent.post(`/receipts/${copy}/not-duplicate`).expect(303);
    expect((await getReceipt(db, copy))?.receipt.status).toBe("draft");
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

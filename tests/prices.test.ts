import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createApp } from "../src/create-app.js";
import type { Db } from "../src/db/client.js";
import {
  type PricePoint,
  productPrices,
  searchProducts,
} from "../src/db/prices-repo.js";
import { saveDraft } from "../src/db/receipts-repo.js";
import { saveUser } from "../src/db/users-repo.js";
import { niceStep, priceChart } from "../src/services/price-chart.js";
import { validateReceipt } from "../src/services/validators.js";
import { testDb } from "./helpers/db.js";
import { item, receipt, VALID_CNPJ } from "./helpers/receipt.js";

const point = (p: Partial<PricePoint>): PricePoint => ({
  receipt_id: 1,
  purchase_date: "2026-01-10",
  store_cnpj: VALID_CNPJ,
  store_name: "EPA",
  user_id: 1,
  owner: "danilo",
  quantity: 1,
  unit: "un",
  unit_price_cents: 500,
  discount_cents: null,
  ...p,
});

describe("priceChart", () => {
  it("sem compras: nada a desenhar", () => {
    expect(priceChart([], 1)).toBeNull();
  });

  it("um ponto por compra, cor por mercado, 'minha' pelo usuário; números e eixos", () => {
    const chart = priceChart(
      [
        point({ purchase_date: "2026-01-10", unit_price_cents: 500 }),
        point({
          purchase_date: "2026-02-10",
          unit_price_cents: 700,
          store_cnpj: "04641376057596",
          store_name: "BH",
          user_id: 2,
          owner: "rafael",
        }),
        point({ purchase_date: "2026-03-10", unit_price_cents: 600 }),
      ],
      1,
    );
    if (!chart) throw new Error("gráfico vazio");
    expect(chart.stats).toEqual({
      count: 3,
      lastCents: 600,
      minCents: 500,
      maxCents: 700,
      avgCents: 600,
      users: 2,
    });
    expect(chart.stores.map((s) => [s.name, s.count, s.lastCents])).toEqual([
      ["EPA", 2, 600],
      ["BH", 1, 700],
    ]);
    const [a, b, c] = chart.points;
    expect(a?.color).toBe(c?.color);
    expect(a?.color).not.toBe(b?.color);
    expect(chart.points.map((p) => p.mine)).toEqual([true, false, true]);
    // Mais caro = mais alto (y menor); mais novo = mais à direita.
    expect(b && a && b.y < a.y).toBe(true);
    expect(a && c && a.x < c.x).toBe(true);
    // Uma linha por mercado: a do EPA liga só as duas compras dele.
    expect(chart.stores[0]?.path).toBe(`M${a?.x},${a?.y} L${c?.x},${c?.y}`);
    expect(chart.xTicks.map((t) => t.anchor)).toEqual([
      "start",
      "middle",
      "middle",
      "middle",
      "end",
    ]);
    // Eixo Y em passos redondos que cobrem os preços.
    const cents = chart.yTicks.map((t) => t.cents);
    expect(Math.min(...cents)).toBeLessThanOrEqual(500);
    expect(Math.max(...cents)).toBeGreaterThanOrEqual(700);
  });

  it("usa a unidade mais comum (kg) e deixa a outra só para a tabela", () => {
    const chart = priceChart(
      [point({ unit: "kg" }), point({ unit: "kg" }), point({ unit: "un" })],
      1,
    );
    expect(chart?.unit).toBe("kg");
    expect(chart?.points).toHaveLength(2);
    expect(chart?.otherUnit).toBe(1);
  });

  it("uma data só: o ponto fica no meio, sem dividir por zero", () => {
    const chart = priceChart([point({})], 1);
    expect(chart?.points[0]?.x).toBeGreaterThan(64);
    expect(chart?.points[0]?.x).toBeLessThan(624);
    expect(Number.isFinite(chart?.points[0]?.y)).toBe(true);
  });

  it("niceStep dá passos redondos", () => {
    expect(niceStep(400)).toBe(100);
    expect(niceStep(90)).toBe(25);
    expect(niceStep(0)).toBe(0.25);
  });
});

describe("preços nas notas", () => {
  let db: Db;
  let hash: string;
  beforeAll(async () => {
    hash = await hashPassword("senha");
  });
  beforeEach(async () => {
    db = await testDb();
  });
  afterEach(async () => {
    await db.close();
  });

  /** Nota com um item do produto; confirmada ou não, de quem for. */
  async function bought(
    productId: number,
    cents: number,
    date: string,
    opts: { status?: string; userId?: number | undefined; cnpj?: string } = {},
  ) {
    const r = receipt({
      store: { name: "EPA", cnpj: opts.cnpj ?? VALID_CNPJ, address: null },
      access_key: null,
      items: [item({ unit: "UN", unit_price: cents / 100 })],
    });
    const id = await saveDraft(db, {
      receipt: r,
      validation: validateReceipt(r),
      interpreted: [null],
      calls: { read: null, interpret: null },
      image: null,
    });
    await db.query(
      `update app.receipts set status = $2, purchase_date = $3,
              user_id = coalesce($4, user_id) where id = $1`,
      [id, opts.status ?? "confirmed", date, opts.userId ?? null],
    );
    await db.query(
      "update app.receipt_items set product_id = $2, unit_price_cents = $3 where receipt_id = $1",
      [id, productId, cents],
    );
    return id;
  }

  async function product(name: string) {
    const [row] = await db.query<{ id: number }>(
      `insert into app.products (product, category, source) values ($1, 'Bebidas', 'review')
       returning id`,
      [name],
    );
    return row?.id ?? 0;
  }

  it("só notas confirmadas, de todos os usuários; busca sem acento", async () => {
    await saveUser(db, "rafael", hash);
    const [rafael] = await db.query<{ id: number }>(
      "select id from app.users where username = 'rafael'",
    );
    const agua = await product("Água de coco");
    await bought(agua, 998, "2026-01-05");
    await bought(agua, 1480, "2026-02-05", { userId: rafael?.id });
    await bought(agua, 9999, "2026-03-05", { status: "draft" });
    await bought(agua, 9999, "2026-03-06", { status: "duplicate" });

    const prices = await productPrices(db, agua);
    expect(prices.map((p) => [p.unit_price_cents, p.owner])).toEqual([
      [998, "danilo"],
      [1480, "rafael"],
    ]);
    const [found] = await searchProducts(db, "agua de COCO");
    expect(found).toMatchObject({
      id: agua,
      purchases: 2,
      last_price_cents: 1480,
    });
    expect(await searchProducts(db, "cerveja")).toEqual([]);
  });

  it("telas: lista, página com gráfico e tabela, 404", async () => {
    const agua = await product("Água de coco");
    const receiptId = await bought(agua, 998, "2026-01-05");
    await bought(agua, 1200, "2026-02-05");
    const agent = request.agent(
      createApp({
        db,
        accept: async () => ({ kind: "queued", id: 1 }),
        process: async () => {},
        background: () => {},
        passwordHash: hash,
        sessionSecret: "x".repeat(32),
      }),
    );
    await agent
      .post("/login")
      .type("form")
      .send({ username: "danilo", password: "senha" })
      .expect(303);

    const list = await agent.get("/products?q=agua").expect(200);
    expect(list.text).toContain(`/products/${agua}`);
    const page = await agent.get(`/products/${agua}`).expect(200);
    expect(page.text).toContain("<svg");
    expect(page.text).toContain(`/receipts/${receiptId}`);
    expect(page.text).toContain("sua nota");
    expect(page.text).toMatch(/R\$\s?12,00/);
    await agent.get("/products/999999").expect(404);
    await agent.get("/products/abc").expect(404);
  });
});

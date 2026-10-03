import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import { createDbMemory } from "../src/db/memory.js";
import { migrate } from "../src/db/migrate.js";
import {
  type ConfirmedItem,
  confirmReceipt,
  type DraftInput,
  deleteReceipt,
  findReceiptByAccessKey,
  getReceipt,
  listReceipts,
  saveDraft,
} from "../src/db/receipts-repo.js";
import type { ItemRead, ReceiptRead } from "../src/schemas/receipt.js";
import { validateReceipt } from "../src/services/validators.js";
import { testDb } from "./helpers/db.js";
import {
  item,
  receipt,
  VALID_ACCESS_KEY,
  VALID_CNPJ,
} from "./helpers/receipt.js";

let db: Db;
beforeEach(async () => {
  db = await testDb();
});
afterEach(async () => {
  await db.close();
});

const limao: ItemRead = item({
  raw_description: "LIMAO THAITI EX.kg",
  ean: null,
  store_code: "32845",
  quantity: 0.14,
  unit: "kg",
  unit_price: 10.98,
  total_price: 1.54,
});

function draft(
  r: ReceiptRead = receipt({
    items: [item(), limao],
    items_count: 2,
    total: 5.53,
  }),
) {
  return {
    receipt: r,
    validation: validateReceipt(r),
    interpreted: r.items.map(() => null),
    calls: {
      read: {
        model: "claude-sonnet-5-5",
        promptVersion: "read-v1",
        usage: { inputTokens: 8000, outputTokens: 1500 },
        latencyMs: 12000,
        payload: r,
      },
      interpret: null,
    },
  } satisfies DraftInput;
}

function confirmed(
  it: ItemRead,
  overrides: Partial<ConfirmedItem> = {},
): ConfirmedItem {
  const cents = (v: number | null) => (v === null ? null : Math.round(v * 100));
  return {
    raw_description: it.raw_description,
    ean: it.ean,
    store_code: it.store_code,
    quantity: it.quantity,
    unit: it.unit,
    unit_price_cents: cents(it.unit_price),
    total_price_cents: cents(it.total_price),
    discount_cents: cents(it.discount),
    product: "Água tônica",
    brand: "Schweppes",
    variant: "Zero",
    package_size: 350,
    package_unit: "ml",
    category: "Bebidas",
    confidence: "high",
    ...overrides,
  };
}

const limaoConfirmed = () =>
  confirmed(limao, {
    product: "Limão",
    brand: null,
    variant: "Taiti",
    package_size: null,
    package_unit: null,
    category: "Hortifruti",
  });

describe("migrate", () => {
  it("é idempotente: rodar de novo não reaplica nada", async () => {
    expect(await migrate(db)).toEqual([]);
  });
});

describe("saveDraft / getReceipt", () => {
  it("grava nota, itens em centavos e a extração crua", async () => {
    const id = await saveDraft(db, draft());

    const saved = await getReceipt(db, id);
    expect(saved?.receipt).toMatchObject({
      status: "draft",
      store_cnpj: VALID_CNPJ,
      access_key: VALID_ACCESS_KEY,
      purchase_date: "2025-09-30",
      purchase_time: "18:42",
      total_cents: 553,
      traffic_light: "green",
    });
    expect(
      saved?.items.map((i) => [
        i.raw_description,
        i.unit_price_cents,
        i.quantity,
      ]),
    ).toEqual([
      ["AG TON SCHW ZERO 350", 399, 1],
      ["LIMAO THAITI EX.kg", 1098, 0.14],
    ]);
    expect(saved?.items[0]?.check_status).toBe("ok");

    const [extraction] = await db.query<{
      stage: string;
      input_tokens: number;
    }>(
      "select stage, input_tokens from app.extractions where receipt_id = $1",
      [id],
    );
    expect(extraction).toEqual({ stage: "read", input_tokens: 8000 });
  });

  it("acha nota pela chave de acesso (duplicata)", async () => {
    const id = await saveDraft(db, draft());
    expect(await findReceiptByAccessKey(db, VALID_ACCESS_KEY)).toEqual({
      id,
      status: "draft",
    });
    expect(await findReceiptByAccessKey(db, "0".repeat(44))).toBeNull();
  });

  it("não aceita duas notas com a mesma chave de acesso", async () => {
    await saveDraft(db, draft());
    await expect(saveDraft(db, draft())).rejects.toThrow();
  });

  it("lista e exclui notas (itens vão junto)", async () => {
    const id = await saveDraft(db, draft());
    expect((await listReceipts(db)).map((r) => [r.id, r.item_lines])).toEqual([
      [id, 2],
    ]);

    expect(await deleteReceipt(db, id)).toBe(true);
    expect(await listReceipts(db)).toEqual([]);
    const [{ n }] = (await db.query<{ n: number }>(
      "select count(*)::int as n from app.receipt_items",
    )) as [{ n: number }];
    expect(n).toBe(0);
  });
});

describe("confirmReceipt + memória", () => {
  it("confirma, marca o que foi editado e alimenta a memória", async () => {
    const id = await saveDraft(db, draft());

    await confirmReceipt(db, id, [confirmed(item()), limaoConfirmed()]);

    const saved = await getReceipt(db, id);
    expect(saved?.receipt.status).toBe("confirmed");
    expect(saved?.items.every((i) => i.product_id !== null)).toBe(true);
    // o rascunho não tinha interpretação: os dois itens contam como editados
    expect(saved?.items.map((i) => i.edited_by_user)).toEqual([true, true]);

    const memory = createDbMemory(db);
    const store = { name: "OUTRO MERCADO", cnpj: "99888777000100" };
    // EAN do fabricante: vale em qualquer mercado
    expect(
      await memory.find(
        item({ raw_description: "AGUA TONICA SCHWEPPES" }),
        store,
      ),
    ).toMatchObject({
      product: "Água tônica",
      variant: "Zero",
    });
    // código interno: só na mesma rede
    expect(await memory.find(limao, store)).toBeNull();
    expect(
      await memory.find(limao, { name: null, cnpj: VALID_CNPJ }),
    ).toMatchObject({
      product: "Limão",
      variant: "Taiti",
    });
    // descrição crua igual, na mesma rede, mesmo sem código
    expect(
      await memory.find(
        { ...limao, store_code: null },
        { name: null, cnpj: VALID_CNPJ },
      ),
    ).toMatchObject({ product: "Limão" });
  });

  it("a última confirmação vence (correção vale para as próximas notas)", async () => {
    const first = await saveDraft(db, draft());
    await confirmReceipt(db, first, [
      confirmed(item(), { variant: "Tradicional" }),
    ]);
    const second = await saveDraft(db, draft(receipt({ access_key: null })));
    await confirmReceipt(db, second, [confirmed(item(), { variant: "Zero" })]);

    const memory = createDbMemory(db);
    expect((await memory.find(item(), store()))?.variant).toBe("Zero");
    const [{ n }] = (await db.query<{ n: number }>(
      "select count(*)::int as n from app.products",
    )) as [{ n: number }];
    expect(n).toBe(1);
  });

  it("código de balança (EAN começando com 2) não vira identidade do produto", async () => {
    const linguica = item({
      raw_description: "LING.MISTA PERD.kg",
      ean: "2032218010890",
      quantity: 0.612,
      unit: "kg",
      unit_price: 17.8,
      total_price: 10.89,
    });
    const id = await saveDraft(
      db,
      draft(receipt({ items: [linguica], total: 10.89 })),
    );
    await confirmReceipt(db, id, [
      confirmed(linguica, {
        product: "Linguiça",
        brand: "Perdigão",
        variant: "Mista",
        package_size: null,
        package_unit: null,
        category: "Açougue e peixaria",
      }),
    ]);

    const [product] = await db.query<{ ean: string | null }>(
      "select ean from app.products",
    );
    expect(product?.ean).toBeNull();
    // outra etiqueta da mesma linguiça (outro peso/preço): acha pela descrição
    const memory = createDbMemory(db);
    expect(
      await memory.find(
        { ...linguica, ean: "2032216008330" },
        { name: null, cnpj: VALID_CNPJ },
      ),
    ).toMatchObject({ product: "Linguiça", variant: "Mista" });
  });

  it("revalida os itens confirmados", async () => {
    const id = await saveDraft(db, draft());
    await confirmReceipt(db, id, [
      confirmed(item(), { total_price_cents: 500 }),
    ]);
    const saved = await getReceipt(db, id);
    expect(saved?.items[0]?.check_status).toBe("error");
  });
});

function store() {
  return { name: null, cnpj: VALID_CNPJ };
}

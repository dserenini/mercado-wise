import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import { cachedLookups, lookupEans } from "../src/db/ean-repo.js";
import {
  getReceipt,
  rememberItem,
  saveDraft,
} from "../src/db/receipts-repo.js";
import type { ItemRead } from "../src/schemas/receipt.js";
import { completeBrand, offBrand } from "../src/services/brands.js";
import type { InterpretedItem } from "../src/services/interpreter.js";
import type { OffFetch, OffProduct } from "../src/services/off.js";
import { withBrandHints } from "../src/services/review.js";
import { validateReceipt } from "../src/services/validators.js";
import { testDb } from "./helpers/db.js";
import { item, receipt, VALID_CNPJ } from "./helpers/receipt.js";

const KNOWN = ["Albanos", "Aliança", "Piracanjuba", "Piraquê", "Cisne"];

describe("completeBrand", () => {
  it("completa a abreviação quando só uma marca conhecida serve", () => {
    expect(completeBrand("Alba", KNOWN)).toBe("Albanos");
    expect(completeBrand("ALIA", KNOWN)).toBe("Aliança");
  });

  it("não sugere quando várias servem, nenhuma serve ou a marca já é conhecida", () => {
    expect(completeBrand("Pira", KNOWN)).toBeNull();
    expect(completeBrand("Itan", KNOWN)).toBeNull();
    expect(completeBrand("Cisne", KNOWN)).toBeNull();
    expect(completeBrand("A", KNOWN)).toBeNull();
    expect(completeBrand(null, KNOWN)).toBeNull();
  });
});

describe("offBrand", () => {
  it("primeira marca da lista, com a grafia já confirmada ou sem caixa alta", () => {
    expect(offBrand("CISNE", KNOWN)).toBe("Cisne");
    expect(offBrand("GATORADE", KNOWN)).toBe("Gatorade");
    expect(offBrand("Dori, Petitz", KNOWN)).toBe("Dori");
    expect(offBrand("Baden Baden", KNOWN)).toBe("Baden Baden");
    expect(offBrand(null, KNOWN)).toBeNull();
  });
});

let db: Db;
beforeEach(async () => {
  db = await testDb();
});
afterEach(async () => {
  await db.close();
});

const found = (brand: string): OffProduct => ({
  found: true,
  brand,
  product_name: `Produto ${brand}`,
  quantity: "500 g",
});
const missing: OffProduct = {
  found: false,
  brand: null,
  product_name: null,
  quantity: null,
};

describe("lookupEans", () => {
  it("guarda encontrados e não encontrados, e não pergunta de novo", async () => {
    const asked: string[] = [];
    const fetchOne: OffFetch = async (ean) => {
      asked.push(ean);
      return ean === "1" ? found("Dori") : missing;
    };
    await lookupEans(db, ["1", "2", "1"], fetchOne, 0);
    await lookupEans(db, ["1", "2"], fetchOne, 0);
    expect(asked).toEqual(["1", "2"]);
    const cached = await cachedLookups(db, ["1", "2"]);
    expect(cached.get("1")).toMatchObject({ found: true, brand: "Dori" });
    expect(cached.get("2")).toMatchObject({ found: false });
  });

  it("falha de rede não fica guardada; limite de consultas interrompe", async () => {
    const asked: string[] = [];
    const fetchOne: OffFetch = async (ean) => {
      asked.push(ean);
      return ean === "1" ? null : "slow-down";
    };
    await lookupEans(db, ["1", "2", "3"], fetchOne, 0);
    expect(asked).toEqual(["1", "2"]);
    expect((await cachedLookups(db, ["1", "2", "3"])).size).toBe(0);
  });
});

describe("withBrandHints", () => {
  const ai = (brand: string | null): InterpretedItem => ({
    product: "Cerveja",
    brand,
    variant: null,
    package_size: 473,
    package_unit: "ml",
    category: "Bebidas",
    confidence: "high",
    source: "ai",
  });

  async function draftWith(lines: [ItemRead, InterpretedItem][]) {
    const r = receipt({
      items: lines.map(([i]) => i),
      items_count: lines.length,
      total: lines.reduce((s, [i]) => s + (i.total_price ?? 0), 0),
    });
    const id = await saveDraft(db, {
      receipt: r,
      validation: validateReceipt(r),
      interpreted: lines.map(([, it]) => it),
      calls: { read: null, interpret: null },
      image: null,
    });
    const saved = await getReceipt(db, id);
    if (!saved) throw new Error("rascunho sumiu");
    return saved;
  }

  it("código de barras primeiro, depois a abreviação pelo histórico", async () => {
    await rememberItem(
      db,
      {
        ...ai("Albanos"),
        raw_description: "CER.ALBA.PIL.473ML",
        ean: "7898659621386",
        store_code: null,
      },
      VALID_CNPJ,
      "review",
    );
    // EAN com marca no Open Food Facts (já guardada pela consulta em segundo plano)
    await lookupEans(db, ["7891149103102"], async () => found("BRAHMA"), 0);

    const saved = await draftWith([
      [
        item({ raw_description: "CERV BRAHMA 350", ean: "7891149103102" }),
        ai(null),
      ],
      [item({ raw_description: "CERV ALBA 473", ean: null }), ai("Alba")],
      [item({ raw_description: "CERV XYZ 473", ean: null }), ai("Xyz")],
    ]);
    const [off, history, none] = (await withBrandHints(db, saved)).items;

    expect(off).toMatchObject({
      brand: "Brahma",
      brand_hint: { source: "off", from: null },
      off_name: "Produto BRAHMA · 500 g",
    });
    expect(history).toMatchObject({
      brand: "Albanos",
      brand_hint: { source: "history", from: "Alba" },
    });
    expect(none?.brand).toBe("Xyz");
    expect(none?.brand_hint).toBeUndefined();
  });
});

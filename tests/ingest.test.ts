import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/db/client.js";
import { getReceipt } from "../src/db/receipts-repo.js";
import type { ReceiptRead } from "../src/schemas/receipt.js";
import { hashDistance, imageHash } from "../src/services/image.js";
import {
  acceptPhoto,
  KEY_DUPLICATE_REASON,
  type ProcessOptions,
  processReceipt,
} from "../src/services/ingest.js";
import type { InterpretationMemory } from "../src/services/interpreter.js";
import { ReadError } from "../src/services/reader.js";
import { testDb } from "./helpers/db.js";
import { item, receipt } from "./helpers/receipt.js";

let db: Db;
beforeEach(async () => {
  db = await testDb();
});
afterEach(async () => {
  await db.close();
});

/** "Foto" de ruído aleatório: cada uma tem impressão digital própria. */
async function noisePhoto(seed: number, width = 600, height = 1200) {
  let x = seed;
  const pixels = Buffer.alloc(40 * 80 * 3);
  for (let i = 0; i < pixels.length; i++) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    pixels[i] = x % 256;
  }
  return sharp(pixels, { raw: { width: 40, height: 80, channels: 3 } })
    .resize(width, height, { kernel: "nearest" })
    .jpeg({ quality: 90 })
    .toBuffer();
}

// Memória que conhece todo item: a interpretação não chama a IA nos testes.
const memory: InterpretationMemory = {
  find: async () => ({
    product: "Água tônica",
    brand: "Schweppes",
    variant: null,
    package_size: 350,
    package_unit: "ml",
    category: "Bebidas",
    confidence: "high",
  }),
};

function reading(r: ReceiptRead): ProcessOptions {
  return {
    memory,
    pollMs: 1,
    read: async () => ({
      receipt: r,
      model: "teste",
      promptVersion: "teste",
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 1,
    }),
  };
}

describe("impressão digital da foto", () => {
  it("a mesma foto reduzida e recomprimida fica perto; outra foto, longe", async () => {
    const a = await noisePhoto(1);
    const smaller = await sharp(a).resize(300).jpeg({ quality: 60 }).toBuffer();
    const b = await noisePhoto(2);
    expect(
      hashDistance(await imageHash(a), await imageHash(smaller)),
    ).toBeLessThan(24);
    expect(
      hashDistance(await imageHash(a), await imageHash(b)),
    ).toBeGreaterThan(52);
  });
});

describe("acceptPhoto", () => {
  it("cria a nota 'lendo' e recusa a mesma foto de novo", async () => {
    const first = await acceptPhoto(db, await noisePhoto(1));
    expect(first.kind).toBe("queued");
    const again = await acceptPhoto(
      db,
      await sharp(await noisePhoto(1))
        .resize(400)
        .toBuffer(),
    );
    expect(again).toEqual({
      kind: "same-photo",
      id: first.id,
      status: "processing",
    });
    expect((await acceptPhoto(db, await noisePhoto(2))).kind).toBe("queued");
  });
});

describe("processReceipt", () => {
  it("lê, interpreta e grava o rascunho", async () => {
    const { id } = await acceptPhoto(db, await noisePhoto(1));
    await processReceipt(db, id, reading(receipt()));
    const saved = await getReceipt(db, id);
    expect(saved?.receipt).toMatchObject({
      status: "draft",
      store_name: "SUPERMERCADO X",
    });
    expect(saved?.items[0]).toMatchObject({
      product: "Água tônica",
      interpretation_source: "memory",
    });
  });

  it("mesma chave de acesso: repetida certa, sem gravar itens", async () => {
    const first = await acceptPhoto(db, await noisePhoto(1));
    await processReceipt(db, first.id, reading(receipt()));
    const second = await acceptPhoto(db, await noisePhoto(2));
    await processReceipt(db, second.id, reading(receipt()));
    const saved = await getReceipt(db, second.id);
    expect(saved?.receipt).toMatchObject({
      status: "duplicate",
      duplicate_of: first.id,
      duplicate_reason: KEY_DUPLICATE_REASON,
    });
    expect(saved?.items).toEqual([]);
  });

  it("chave ilegível mas mesmos itens, valor, dia e mercado: possível repetida", async () => {
    const items = [
      item({ raw_description: "LEITE", ean: "7891000100103" }),
      item({ raw_description: "PAO", ean: null, store_code: "42858" }),
    ];
    const first = await acceptPhoto(db, await noisePhoto(1));
    await processReceipt(
      db,
      first.id,
      reading(receipt({ items, items_count: 2, total: 7.98 })),
    );
    const second = await acceptPhoto(db, await noisePhoto(2));
    await processReceipt(
      db,
      second.id,
      reading(
        receipt({ access_key: null, items, items_count: 2, total: 7.98 }),
      ),
    );
    const saved = await getReceipt(db, second.id);
    expect(saved?.receipt.status).toBe("duplicate");
    expect(saved?.receipt.duplicate_of).toBe(first.id);
    expect(saved?.receipt.duplicate_reason).toContain("2 de 2 itens iguais");
    expect(saved?.items).toHaveLength(2); // dá para revisar e decidir
  });

  it("erro na leitura vira 'falhou' com a mensagem", async () => {
    const { id } = await acceptPhoto(db, await noisePhoto(1));
    await processReceipt(db, id, {
      pollMs: 1,
      read: async () => {
        throw new ReadError("A resposta veio cortada.");
      },
    });
    expect((await getReceipt(db, id))?.receipt).toMatchObject({
      status: "failed",
      error: "A resposta veio cortada.",
    });
  });
});

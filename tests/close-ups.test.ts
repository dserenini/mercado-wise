import sharp from "sharp";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createApp } from "../src/create-app.js";
import type { Db } from "../src/db/client.js";
import { getReceipt, MAX_CLOSE_UPS } from "../src/db/receipts-repo.js";
import type { PreparedImage } from "../src/services/image.js";
import {
  type AcceptResult,
  acceptPhoto,
  processReceipt,
} from "../src/services/ingest.js";
import { freshDb, testDb } from "./helpers/db.js";
import { receipt } from "./helpers/receipt.js";

const PASSWORD = "senha-de-teste";
let passwordHash: string;
let db: Db;
let processed: number[];
let acceptResult: AcceptResult | null;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});
beforeEach(async () => {
  db = await testDb();
  processed = [];
  acceptResult = null;
});
afterEach(async () => {
  await db.close();
});

const photo = (shade: number) =>
  sharp({
    create: {
      width: 40,
      height: 80,
      channels: 3,
      background: { r: shade, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer();

async function agent(database = db) {
  const app = createApp({
    db: database,
    accept: async (p, userId) =>
      acceptResult ?? acceptPhoto(database, p, userId),
    process: async (id) => {
      processed.push(id);
    },
    background: () => {},
    passwordHash,
    sessionSecret: "x".repeat(32),
  });
  const a = request.agent(app);
  await a
    .post("/login")
    .type("form")
    .send({ username: "danilo", password: PASSWORD })
    .expect(303);
  return a;
}

describe("nota com fotos de perto", () => {
  it("wait=1 cria sem ler; fotos de perto entram em ordem; /read começa a leitura uma vez", async () => {
    const a = await agent();
    const res = await a
      .post("/receipts")
      .set("Accept", "application/json")
      .field("wait", "1")
      .attach("photo", await photo(10), "nota.jpg")
      .expect(200);
    const id = res.body.results[0].id;
    expect(processed).toEqual([]);

    for (const shade of [100, 200])
      await a
        .post(`/receipts/${id}/photos`)
        .attach("photo", await photo(shade), "perto.jpg")
        .expect(200, { kind: "added" });

    await a.post(`/receipts/${id}/read`).expect(200);
    expect(processed).toEqual([id]);

    // A leitura recebe a foto geral e as de perto, na ordem em que chegaram.
    let seen: PreparedImage[] = [];
    await processReceipt(db, id, {
      pollMs: 1,
      memory: {
        find: async () => ({
          product: "Água tônica",
          brand: null,
          variant: null,
          package_size: null,
          package_unit: null,
          category: "Bebidas",
          confidence: "high",
        }),
      },
      read: async (_image, closeUps) => {
        seen = closeUps;
        return {
          receipt: receipt(),
          model: "teste",
          promptVersion: "teste",
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        };
      },
    });
    expect(seen).toHaveLength(2);
    const reds = await Promise.all(
      seen.map(async (s) => (await sharp(s.data).stats()).channels[0]?.mean),
    );
    expect(reds[0]).toBeLessThan(reds[1] as number);
    expect((await getReceipt(db, id))?.receipt.status).toBe("draft");

    // Já lida: não aceita mais fotos nem outra leitura.
    await a
      .post(`/receipts/${id}/photos`)
      .attach("photo", await photo(50), "perto.jpg")
      .expect(409, { kind: "not-found" });
    await a.post(`/receipts/${id}/read`).expect(409);
    await a.get(`/receipts/${id}/photos/2`).expect(200);
    await a.get(`/receipts/${id}/photos/3`).expect(404);
  });

  it("sem wait, a leitura começa no envio (como antes)", async () => {
    const a = await agent();
    acceptResult = { kind: "queued", id: 42 };
    await a
      .post("/receipts")
      .set("Accept", "application/json")
      .attach("photo", await photo(10), "nota.jpg")
      .expect(200);
    expect(processed).toEqual([42]);
  });

  it(`aceita até ${MAX_CLOSE_UPS} fotos de perto`, async () => {
    const a = await agent();
    const { id } = (await acceptPhoto(db, await photo(10))) as { id: number };
    for (let i = 0; i < MAX_CLOSE_UPS; i++)
      await a
        .post(`/receipts/${id}/photos`)
        .attach("photo", await photo(20 + i), "p.jpg")
        .expect(200);
    await a
      .post(`/receipts/${id}/photos`)
      .attach("photo", await photo(99), "p.jpg")
      .expect(409, { kind: "full" });
  });

  it("banco sem a migration 011: avisa ao enviar foto de perto; a nota é lida só pela foto geral", async () => {
    const old = await freshDb();
    await old.exec("drop table app.receipt_photos");
    const a = await agent(old);
    const { id } = (await acceptPhoto(old, await photo(10))) as { id: number };
    await a
      .post(`/receipts/${id}/photos`)
      .attach("photo", await photo(20), "p.jpg")
      .expect(503, { kind: "unavailable" });
    await a.get(`/receipts/${id}`).expect(200);
    await old.close();
  });
});

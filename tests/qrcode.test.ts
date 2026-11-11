import sharp from "sharp";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { createApp } from "../src/create-app.js";
import type { Db } from "../src/db/client.js";
import { getReceipt } from "../src/db/receipts-repo.js";
import { getReceiptSource } from "../src/db/sources-repo.js";
import type { ReceiptRead } from "../src/schemas/receipt.js";
import {
  acceptPage,
  acceptPhoto,
  type PageAcceptResult,
  type ProcessOptions,
  processReceipt,
} from "../src/services/ingest.js";
import type { InterpretationMemory } from "../src/services/interpreter.js";
import { cnpjFromKey, pageHasKey, parseNfceQr } from "../src/services/nfce.js";
import { freshDb, testDb } from "./helpers/db.js";
import {
  item,
  receipt,
  VALID_ACCESS_KEY,
  VALID_CNPJ,
} from "./helpers/receipt.js";

const KEY = VALID_ACCESS_KEY; // traz o CNPJ VALID_CNPJ dentro
const SP = `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=${KEY}%7C2%7C1%7C1%7C86724471BA69C7307C62D33226F6FF037C316C18`;
const PAGE = `Consulta Resumida NFC-e\nTAUSTE SUPERMERCADOS LTDA\nDES YPE PIN LAVANDA (Código: 23748) Qtde.: 1 UN: FR Vl. Unit.: 5,99\nChave de acesso: ${KEY.replace(/(\d{4})/g, "$1 ").trim()}`;

describe("QR Code da NFC-e", () => {
  it("aceita o QR de NFC-e de qualquer estado (.gov.br com chave em p)", () => {
    expect(parseNfceQr(SP)).toEqual({ url: SP, accessKey: KEY });
    const mg = `http://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml?p=${KEY}|2|1|1|ABC`;
    expect(parseNfceQr(mg)).toMatchObject({ accessKey: KEY });
  });

  it("recusa QR que não é de NFC-e", () => {
    for (const raw of [
      "00020126580014BR.GOV.BCB.PIX0136...", // Pix
      `https://exemplo.com/?p=${KEY}`, // fora do governo
      `https://evil.gov.br.exemplo.com/?p=${KEY}`,
      `javascript:alert(1)//.gov.br?p=${KEY}`,
      "https://www.nfce.fazenda.sp.gov.br/qrcode?p=123|2|1",
      "https://www.nfce.fazenda.sp.gov.br/qrcode",
    ])
      expect(parseNfceQr(raw)).toHaveProperty("error");
  });

  it("texto colado é da nota se trouxer a chave (com ou sem espaços); CNPJ sai da chave", () => {
    expect(pageHasKey(PAGE, KEY)).toBe(true);
    expect(pageHasKey("outra nota qualquer", KEY)).toBe(false);
    expect(cnpjFromKey(KEY)).toBe(VALID_CNPJ);
  });
});

let db: Db;
beforeEach(async () => {
  db = await testDb();
});
afterEach(async () => {
  await db.close();
});

const memory: InterpretationMemory = {
  find: async () => ({
    product: "Desinfetante",
    brand: "Ypê",
    variant: "Lavanda",
    package_size: null,
    package_unit: null,
    category: "Limpeza",
    confidence: "high",
  }),
};

/** Leitura falsa que erra a chave e não acha o CNPJ (como a foto amassada). */
function wrongHeader(): ReceiptRead {
  return receipt({
    store: { name: "TAUSTE", cnpj: null, address: null },
    access_key: `${KEY.slice(0, 40)}9999`,
    items: [item()],
  });
}

function fakeReads(calls: string[]): ProcessOptions {
  const result = (r: ReceiptRead) => ({
    receipt: r,
    model: "teste",
    promptVersion: "teste",
    usage: { inputTokens: 1, outputTokens: 1 },
    latencyMs: 1,
  });
  return {
    memory,
    pollMs: 1,
    read: async () => {
      calls.push("foto");
      return result(wrongHeader());
    },
    readPage: async (text) => {
      calls.push(`página:${text.length}`);
      return result(wrongHeader());
    },
  };
}

describe("nota pela página da SEFAZ", () => {
  it("cria a nota com a chave do QR, lê pelo texto (não pela foto) e corrige chave e CNPJ", async () => {
    const accepted = await acceptPage(db, SP, PAGE, 1);
    if (accepted.kind !== "queued") throw new Error(JSON.stringify(accepted));
    expect(await getReceiptSource(db, accepted.id)).toMatchObject({
      access_key: KEY,
      page_text: PAGE,
    });

    const calls: string[] = [];
    await processReceipt(db, accepted.id, fakeReads(calls));
    expect(calls).toEqual([`página:${PAGE.length}`]);
    const saved = await getReceipt(db, accepted.id);
    expect(saved?.receipt).toMatchObject({
      status: "draft",
      source: "qrcode",
      access_key: KEY,
      store_cnpj: VALID_CNPJ,
      has_image: false,
    });
  });

  it("recusa texto de outra nota, QR inválido e nota já cadastrada", async () => {
    const results: PageAcceptResult[] = [
      await acceptPage(db, SP, "texto sem a chave", 1),
      await acceptPage(db, "https://exemplo.com", PAGE, 1),
    ];
    expect(results.map((r) => r.kind)).toEqual(["error", "error"]);
    const first = await acceptPage(db, SP, PAGE, 1);
    expect(await acceptPage(db, SP, PAGE, 1)).toEqual({
      kind: "duplicate",
      id: first.kind === "queued" ? first.id : -1,
      status: "processing",
    });
  });

  it("banco sem a migration 010: avisa, sem quebrar", async () => {
    const old = await freshDb();
    await old.exec("drop table app.receipt_sources");
    expect(await acceptPage(old, SP, PAGE, 1)).toMatchObject({ kind: "error" });
    await old.close();
  });
});

describe("foto com QR lido antes", () => {
  it("lê pela foto, mas a chave e o CNPJ vêm do QR", async () => {
    const photo = await sharp({
      create: { width: 400, height: 800, channels: 3, background: "#eee" },
    })
      .jpeg()
      .toBuffer();
    const accepted = await acceptPhoto(db, photo, undefined, SP);
    if (accepted.kind !== "queued") throw new Error("não enfileirou");
    const calls: string[] = [];
    await processReceipt(db, accepted.id, fakeReads(calls));
    expect(calls).toEqual(["foto"]);
    expect((await getReceipt(db, accepted.id))?.receipt).toMatchObject({
      access_key: KEY,
      store_cnpj: VALID_CNPJ,
      has_image: true,
    });
  });
});

describe("rota POST /receipts/page", () => {
  let hash: string;
  beforeAll(async () => {
    hash = await hashPassword("senha");
  });

  it("enfileira e processa em segundo plano; erro volta 400 com a mensagem", async () => {
    const processed: number[] = [];
    const sent: unknown[] = [];
    const app = createApp({
      db,
      accept: async () => ({ kind: "queued", id: 1 }),
      acceptPage: async (qrUrl, text, userId) => {
        sent.push({ qrUrl, len: text.length, userId });
        return text.includes("erro")
          ? { kind: "error", message: "texto errado" }
          : { kind: "queued", id: 7 };
      },
      process: async (id) => {
        processed.push(id);
      },
      background: () => {},
      passwordHash: hash,
      sessionSecret: "x".repeat(32),
    });
    const agent = request.agent(app);
    await agent
      .post("/login")
      .type("form")
      .send({ username: "danilo", password: "senha" })
      .expect(303);
    const ok = await agent
      .post("/receipts/page")
      .send({ qr_url: SP, page_text: PAGE })
      .expect(200);
    expect(ok.body).toEqual({ kind: "queued", id: 7 });
    expect(processed).toEqual([7]);
    expect(sent).toEqual([{ qrUrl: SP, len: PAGE.length, userId: 1 }]);
    const bad = await agent
      .post("/receipts/page")
      .send({ qr_url: SP, page_text: "erro" })
      .expect(400);
    expect(bad.body.message).toBe("texto errado");
    // sem login, não entra
    await request(app).post("/receipts/page").send({}).expect(303);
  });
});

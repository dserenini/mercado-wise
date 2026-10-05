import type { Db } from "../db/client.js";
import { findProbableDuplicate } from "../db/duplicates-repo.js";
import { createDbMemory } from "../db/memory.js";
import {
  claimReadSlot,
  createPending,
  draftFromPipeline,
  fillDraft,
  findReceiptByAccessKey,
  getReceiptImage,
  markDuplicate,
  markFailed,
  photoHashes,
  type ReceiptStatus,
} from "../db/receipts-repo.js";
import {
  hashDistance,
  imageHash,
  type PreparedImage,
  prepareImage,
} from "./image.js";
import type { InterpretationMemory } from "./interpreter.js";
import { completeReading } from "./pipeline.js";
import { ReadError, type ReadResult, readReceipt } from "./reader.js";

// Envio de nota em duas etapas:
// 1. acceptPhoto (rápido, na requisição do envio): prepara a foto, recusa foto já
//    cadastrada (camada 1) e cria a nota com status 'processing';
// 2. processReceipt (segundo plano, ~30 s): lê, recusa chave de acesso já cadastrada
//    (camada 2), valida, interpreta, grava o rascunho e marca "possível repetida"
//    (camada 3). Nunca lança: o erro vira status 'failed' com a mensagem.

/** Até quantos bits de diferença (de 256) a foto é considerada a mesma. Medido nas
 *  fixtures: mesma foto via WhatsApp 5–16; notas diferentes 52 ou mais. */
export const SAME_PHOTO_MAX_DISTANCE = 24;

/** Leituras simultâneas: acima disso a API recusa por limite de uso. */
export const MAX_CONCURRENT_READS = 3;

export const KEY_DUPLICATE_REASON = "mesma chave de acesso";

export type AcceptResult =
  | { kind: "queued"; id: number }
  | { kind: "same-photo"; id: number; status: ReceiptStatus };

export async function acceptPhoto(
  db: Db,
  photo: Buffer,
): Promise<AcceptResult> {
  const image = await prepareImage(photo);
  const hash = await imageHash(image.data);
  const same = (await photoHashes(db)).find(
    (p) => hashDistance(p.hash, hash) <= SAME_PHOTO_MAX_DISTANCE,
  );
  if (same) return { kind: "same-photo", id: same.id, status: same.status };
  return { kind: "queued", id: await createPending(db, image, hash) };
}

export interface ProcessOptions {
  /** nos testes, uma leitura falsa; padrão: a IA */
  read?: (image: PreparedImage) => Promise<ReadResult>;
  memory?: InterpretationMemory;
  /** espera pela vez de ler (padrão: 5 s entre tentativas, até 3 min: somada à
   *  leitura, cabe nos 5 min que a Vercel dá para cada envio) */
  pollMs?: number;
  maxWaitMs?: number;
}

export async function processReceipt(
  db: Db,
  id: number,
  options: ProcessOptions = {},
): Promise<void> {
  try {
    await waitForSlot(db, id, options);
    const image = await getReceiptImage(db, id);
    if (!image) throw new Error("A foto da nota não foi encontrada.");

    const read = await (options.read ?? readReceipt)(image);

    // Camada 2: a chave de acesso é única por nota fiscal.
    const key = read.receipt.access_key;
    const existing = key ? await findReceiptByAccessKey(db, key) : null;
    if (existing && existing.id !== id) {
      await markDuplicate(db, id, existing.id, KEY_DUPLICATE_REASON);
      return;
    }

    const result = await completeReading(
      { image, read },
      { memory: options.memory ?? createDbMemory(db) },
    );
    await fillDraft(db, id, draftFromPipeline(result));

    // Camada 3: itens, valor, data, mercado e pagamento.
    const probable = await findProbableDuplicate(db, id);
    if (probable) await markDuplicate(db, id, probable.id, probable.reason);
  } catch (error) {
    if (!(error instanceof ReadError)) console.error(error);
    await markFailed(
      db,
      id,
      error instanceof ReadError
        ? error.message
        : "Não foi possível ler a nota agora. Tente de novo.",
    ).catch((e) => console.error(e));
  }
}

async function waitForSlot(db: Db, id: number, options: ProcessOptions) {
  const pollMs = options.pollMs ?? 5_000;
  const deadline = Date.now() + (options.maxWaitMs ?? 180_000);
  while (!(await claimReadSlot(db, id, MAX_CONCURRENT_READS))) {
    // Esperou demais: lê assim mesmo (o cliente da API tenta de novo se for recusado).
    if (Date.now() > deadline) {
      await claimReadSlot(db, id, Number.MAX_SAFE_INTEGER);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export type IngestResult =
  | { kind: "saved"; id: number; status: ReceiptStatus }
  | { kind: "same-photo"; id: number; status: ReceiptStatus };

/** Foto → nota lida, tudo de uma vez (script `npm run ingest`). */
export async function ingestPhoto(
  db: Db,
  photo: Buffer,
): Promise<IngestResult> {
  const accepted = await acceptPhoto(db, photo);
  if (accepted.kind === "same-photo") return accepted;
  await processReceipt(db, accepted.id);
  const [row] = await db.query<{ status: ReceiptStatus }>(
    "select status from app.receipts where id = $1",
    [accepted.id],
  );
  return { kind: "saved", id: accepted.id, status: row?.status ?? "failed" };
}

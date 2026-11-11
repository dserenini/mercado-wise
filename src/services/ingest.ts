import type { Db } from "../db/client.js";
import { findProbableDuplicate } from "../db/duplicates-repo.js";
import { lookupEans } from "../db/ean-repo.js";
import { createDbMemory } from "../db/memory.js";
import {
  claimReadSlot,
  createPending,
  draftFromPipeline,
  fillDraft,
  findReceiptByAccessKey,
  getReceipt,
  getReceiptImage,
  markDuplicate,
  markFailed,
  photoHashes,
  type ReceiptStatus,
} from "../db/receipts-repo.js";
import { resolveAi } from "./ai-settings.js";
import { aiClient } from "./claude.js";
import {
  hashDistance,
  imageHash,
  type PreparedImage,
  prepareImage,
} from "./image.js";
import type { InterpretationMemory } from "./interpreter.js";
import type { OffFetch } from "./off.js";
import { completeReading } from "./pipeline.js";
import { ReadError, type ReadResult, readReceipt } from "./reader.js";
import { isManufacturerEan } from "./validators.js";

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

/** Sem userId (scripts), a nota fica com o dono padrão (o primeiro usuário). */
export async function acceptPhoto(
  db: Db,
  photo: Buffer,
  userId?: number,
): Promise<AcceptResult> {
  const image = await prepareImage(photo);
  const hash = await imageHash(image.data);
  const same = (await photoHashes(db)).find(
    (p) => hashDistance(p.hash, hash) <= SAME_PHOTO_MAX_DISTANCE,
  );
  if (same) return { kind: "same-photo", id: same.id, status: same.status };
  return {
    kind: "queued",
    id: await createPending(db, image, hash, userId),
  };
}

export interface ProcessOptions {
  /** nos testes, uma leitura falsa; padrão: a IA */
  read?: (image: PreparedImage) => Promise<ReadResult>;
  memory?: InterpretationMemory;
  /** espera pela vez de ler (padrão: 5 s entre tentativas, até 3 min: somada à
   *  leitura, cabe nos 5 min que a Vercel dá para cada envio) */
  pollMs?: number;
  maxWaitMs?: number;
  /** consulta de EAN (Open Food Facts) depois da leitura; ausente = não consulta */
  lookup?: OffFetch;
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

    // A IA escolhida em Configurações (ou no .env), lida a cada nota.
    const ai = await resolveAi(db);
    if (!options.read && ai.provider === "openai" && !ai.apiKey) {
      throw new ReadError("Sem chave da OpenAI: cadastre em Configurações.");
    }
    const client = aiClient(ai.provider, ai.apiKey);
    const read = await (
      options.read ??
      ((img) => readReceipt(img, { client, model: ai.readerModel }))
    )(image);

    // Camada 2: a chave de acesso é única por nota fiscal.
    const key = read.receipt.access_key;
    const existing = key ? await findReceiptByAccessKey(db, key) : null;
    if (existing && existing.id !== id) {
      await markDuplicate(db, id, existing.id, KEY_DUPLICATE_REASON);
      return;
    }

    const result = await completeReading(
      { image, read },
      {
        memory: options.memory ?? createDbMemory(db),
        client,
        model: ai.interpreterModel,
      },
    );
    await fillDraft(db, id, draftFromPipeline(result));

    // Camada 3: itens, valor, data, mercado e pagamento.
    const probable = await findProbableDuplicate(db, id);
    if (probable) await markDuplicate(db, id, probable.id, probable.reason);

    // A nota já está pronta para revisar; a marca pelo código de barras chega depois.
    if (options.lookup) await lookupDraftEans(db, id, options.lookup);
  } catch (error) {
    if (!(error instanceof ReadError)) console.error(error);
    // 401 nos dois SDKs: chave errada, revogada ou sem crédito na conta.
    const status = (error as { status?: unknown } | null)?.status;
    await markFailed(
      db,
      id,
      error instanceof ReadError
        ? error.message
        : status === 401
          ? "A API recusou a chave: confira em Configurações."
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

/** EANs do fabricante que a memória não resolveu → Open Food Facts. Nunca falha. */
async function lookupDraftEans(db: Db, id: number, lookup: OffFetch) {
  try {
    const saved = await getReceipt(db, id);
    const eans = (saved?.items ?? [])
      .filter((i) => i.interpretation_source !== "memory")
      .map((i) => i.ean)
      .filter((e): e is string => e !== null && isManufacturerEan(e));
    await lookupEans(db, eans, lookup);
  } catch (error) {
    console.error(error);
  }
}

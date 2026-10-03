import type { Db } from "../db/client.js";
import { createDbMemory } from "../db/memory.js";
import {
  draftFromPipeline,
  findReceiptByAccessKey,
  saveDraft,
} from "../db/receipts-repo.js";
import { completeReading, readPhoto } from "./pipeline.js";

export type IngestResult =
  | { kind: "saved"; id: number }
  | { kind: "duplicate"; id: number; status: "draft" | "confirmed" };

/**
 * Foto nova → rascunho no banco. A duplicata é checada logo depois da leitura (a
 * chave de acesso vem dela), antes de gastar a chamada de interpretação.
 */
export async function ingestPhoto(
  db: Db,
  photo: Buffer,
): Promise<IngestResult> {
  const photoRead = await readPhoto(photo);

  const key = photoRead.read.receipt.access_key;
  const duplicate = key ? await findReceiptByAccessKey(db, key) : null;
  if (duplicate) return { kind: "duplicate", ...duplicate };

  const result = await completeReading(photoRead, {
    memory: createDbMemory(db),
  });
  const id = await saveDraft(db, draftFromPipeline(result));
  return { kind: "saved", id };
}

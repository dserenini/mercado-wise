import { isMissingTable } from "../services/ai-settings.js";
import type { NfceQr } from "../services/nfce.js";
import type { Db } from "./client.js";

// O que o QR Code da nota trouxe (app.receipt_sources, migration 010): endereço,
// chave de acesso exata e, se a pessoa colou, o texto da página da SEFAZ.

export interface ReceiptSource {
  qr_url: string;
  access_key: string;
  page_text: string | null;
}

/**
 * Nota nova a partir do texto da página da SEFAZ (sem foto), já com a chave de
 * acesso do QR. Lança se a tabela não existir (banco sem a migration 010).
 */
export async function createFromPage(
  db: Db,
  qr: NfceQr,
  pageText: string,
  userId: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx.query<{ id: number }>(
      `insert into app.receipts (source, status, access_key, user_id)
       values ('qrcode', 'processing', $1, $2) returning id`,
      [qr.accessKey, userId],
    );
    if (!row) throw new Error("insert em receipts não devolveu id");
    await tx.query(
      `insert into app.receipt_sources (receipt_id, qr_url, access_key, page_text)
       values ($1, $2, $3, $4)`,
      [row.id, qr.url, qr.accessKey, pageText],
    );
    return row.id;
  });
}

/** Foto de nota cujo QR foi lido: guarda a chave exata (sem migration, ignora). */
export async function addQrToReceipt(
  db: Db,
  receiptId: number,
  qr: NfceQr,
): Promise<void> {
  try {
    await db.query(
      `insert into app.receipt_sources (receipt_id, qr_url, access_key)
       values ($1, $2, $3) on conflict (receipt_id) do nothing`,
      [receiptId, qr.url, qr.accessKey],
    );
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
}

/** O que o QR trouxe para a nota; null se nada (ou banco sem a migration 010). */
export async function getReceiptSource(
  db: Db,
  receiptId: number,
): Promise<ReceiptSource | null> {
  try {
    const [row] = await db.query<ReceiptSource>(
      "select qr_url, access_key, page_text from app.receipt_sources where receipt_id = $1",
      [receiptId],
    );
    return row ?? null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

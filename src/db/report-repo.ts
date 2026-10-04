import { ReceiptReadSchema } from "../schemas/receipt.js";
import type { InterpretedItem } from "../services/interpreter.js";
import type {
  CallUsage,
  ConfirmedLine,
  NoteInput,
} from "../services/report.js";
import type { Db } from "./client.js";

/**
 * Notas lidas por foto (as que têm a extração "read" guardada), com o que a IA
 * devolveu e o que foi confirmado. As importadas sem leitura (import-saved) ficam
 * de fora: não há o que comparar.
 */
export async function loadReportNotes(db: Db): Promise<NoteInput[]> {
  const receipts = await db.query<{
    id: number;
    store_name: string | null;
    status: "draft" | "confirmed";
    read: unknown;
    interpreted: (InterpretedItem | null)[] | null;
  }>(
    `select r.id, r.store_name, r.status, rd.payload as read, ip.payload as interpreted
       from app.receipts r
       join lateral (select payload from app.extractions
                      where receipt_id = r.id and stage = 'read'
                      order by id desc limit 1) rd on true
       left join lateral (select payload from app.extractions
                           where receipt_id = r.id and stage = 'interpret'
                           order by id desc limit 1) ip on true
      order by r.id`,
  );

  const notes: NoteInput[] = [];
  for (const r of receipts) {
    const calls = await db.query<CallUsage>(
      `select model, input_tokens as "inputTokens", output_tokens as "outputTokens",
              latency_ms as "latencyMs"
         from app.extractions where receipt_id = $1 order by id`,
      [r.id],
    );
    const confirmed =
      r.status === "confirmed"
        ? await db.query<ConfirmedLine>(
            `select raw_description, quantity, unit_price_cents, total_price_cents,
                    product, brand, variant
               from app.receipt_items where receipt_id = $1 order by position`,
            [r.id],
          )
        : null;
    notes.push({
      id: r.id,
      storeName: r.store_name,
      read: ReceiptReadSchema.parse(r.read),
      interpreted: r.interpreted,
      confirmed,
      calls,
    });
  }
  return notes;
}

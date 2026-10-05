import { compareNotes, type NoteFacts } from "../services/duplicates.js";
import type { Db } from "./client.js";

interface FactsRow {
  id: number;
  access_key: string | null;
  store_cnpj: string | null;
  store_name: string | null;
  purchase_date: string | null;
  total_cents: number | null;
  payment_method: string | null;
  item_keys: (string | null)[] | null;
}

// Item identificado pelo EAN, senão pelo código interno, senão pela descrição
// normalizada (a mesma da memória).
const FACTS_COLUMNS = `r.id, r.access_key, r.store_cnpj, r.store_name,
  r.purchase_date::text as purchase_date, r.total_cents, r.payment_method,
  (select array_agg(coalesce(nullif(i.ean, ''), nullif(i.store_code, ''),
                             app.description_key(i.raw_description))
                    order by i.position)
     from app.receipt_items i where i.receipt_id = r.id) as item_keys`;

function toFacts(row: FactsRow): NoteFacts {
  return {
    id: row.id,
    accessKey: row.access_key,
    cnpj: row.store_cnpj,
    storeName: row.store_name,
    date: row.purchase_date,
    totalCents: row.total_cents,
    payment: row.payment_method,
    itemKeys: (row.item_keys ?? []).filter((k): k is string => !!k),
  };
}

/**
 * Nota já cadastrada (rascunho ou confirmada) de que a nota `id` parece ser cópia,
 * pela camada 3 (services/duplicates.ts). O banco só pré-seleciona pela data e pelo
 * valor; a comparação de verdade é feita em compareNotes.
 */
export async function findProbableDuplicate(
  db: Db,
  id: number,
): Promise<{ id: number; reason: string } | null> {
  const [me] = await db.query<FactsRow>(
    `select ${FACTS_COLUMNS} from app.receipts r where r.id = $1`,
    [id],
  );
  if (!me) return null;
  const candidates = await db.query<FactsRow>(
    `select ${FACTS_COLUMNS} from app.receipts r
      where r.id <> $1 and r.status in ('draft', 'confirmed')
        and (r.purchase_date is null or $2::date is null or r.purchase_date = $2::date)
        and (r.total_cents is null or $3::int is null
             or abs(r.total_cents - $3::int) <= 0.2 * greatest(r.total_cents, $3::int))
      order by r.id desc`,
    [id, me.purchase_date, me.total_cents],
  );
  const facts = toFacts(me);
  for (const candidate of candidates) {
    const verdict = compareNotes(toFacts(candidate), facts);
    if (verdict.duplicate) return { id: candidate.id, reason: verdict.reason };
  }
  return null;
}

import type { OffFetch, OffProduct } from "../services/off.js";
import type { Db } from "./client.js";

export interface EanLookup extends OffProduct {
  ean: string;
}

/** "Não encontrado" vale por 30 dias: a base cresce, vale perguntar de novo. */
const NOT_FOUND_TTL = "30 days";

export async function cachedLookups(
  db: Db,
  eans: string[],
): Promise<Map<string, EanLookup>> {
  if (eans.length === 0) return new Map();
  const rows = await db.query<EanLookup>(
    `select ean, found, brand, product_name, quantity from app.ean_lookups
      where ean = any($1::text[])
        and (found or fetched_at > now() - interval '${NOT_FOUND_TTL}')`,
    [eans],
  );
  return new Map(rows.map((r) => [r.ean, r]));
}

/**
 * Consulta os EANs que ainda não estão guardados, um por vez, com intervalo, e
 * guarda as respostas. Para no primeiro sinal de limite; falha de rede pula o EAN.
 */
export async function lookupEans(
  db: Db,
  eans: string[],
  fetchOne: OffFetch,
  pauseMs = 700,
): Promise<void> {
  const unique = [...new Set(eans)];
  const cached = await cachedLookups(db, unique);
  let first = true;
  for (const ean of unique.filter((e) => !cached.has(e))) {
    if (!first && pauseMs > 0)
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    first = false;
    const found = await fetchOne(ean);
    if (found === "slow-down") return;
    if (found === null) continue;
    await db.query(
      `insert into app.ean_lookups (ean, found, brand, product_name, quantity)
       values ($1, $2, $3, $4, $5)
       on conflict (ean) do update set found = excluded.found, brand = excluded.brand,
         product_name = excluded.product_name, quantity = excluded.quantity,
         fetched_at = now()`,
      [ean, found.found, found.brand, found.product_name, found.quantity],
    );
  }
}

/** Marcas já confirmadas (para completar abreviações e acertar a grafia). */
export async function knownBrands(db: Db): Promise<string[]> {
  const rows = await db.query<{ brand: string }>(
    "select distinct brand from app.products where brand is not null",
  );
  return rows.map((r) => r.brand);
}

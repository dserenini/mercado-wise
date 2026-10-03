// Uso: npm run seed-memory -- [arquivo]   (padrão: eval/ground-truth/interpretation-v1.json)
// Carrega na memória os itens revisados à mão (gabarito), como produtos confirmados.
// Campos marcados como incertos no gabarito entram vazios.
import { readFile } from "node:fs/promises";
import { connect } from "../src/db/connect.js";
import { rememberItem } from "../src/db/receipts-repo.js";
import {
  type ItemInterpreted,
  ItemInterpretedSchema,
} from "../src/schemas/interpretation.js";

interface TruthItem extends Omit<ItemInterpreted, "confidence"> {
  id: string;
  store_cnpj: string | null;
  raw_description: string | null;
  code: string | null;
  uncertain?: (keyof ItemInterpreted)[];
}

const file = process.argv[2] ?? "eval/ground-truth/interpretation-v1.json";
const truth: { items: TruthItem[] } = JSON.parse(await readFile(file, "utf8"));

const db = connect();
let saved = 0;
let skipped = 0;
try {
  await db.transaction(async (tx) => {
    for (const t of truth.items) {
      const fields = { ...t, confidence: "high" as const };
      for (const f of t.uncertain ?? [])
        (fields as Record<string, unknown>)[f] = null;
      const parsed = ItemInterpretedSchema.safeParse(fields);
      if (!parsed.success || !t.raw_description) {
        skipped++;
        continue;
      }
      // No gabarito, "code" é o EAN (8+ dígitos) ou o código interno do mercado.
      const isEan = t.code !== null && t.code.length >= 8;
      await rememberItem(
        tx,
        {
          ...parsed.data,
          raw_description: t.raw_description,
          ean: isEan ? t.code : null,
          store_code: isEan ? null : t.code,
        },
        t.store_cnpj,
        "ground-truth",
      );
      saved++;
    }
  });
  const [counts] = await db.query<{ products: number; aliases: number }>(
    `select (select count(*)::int from app.products) as products,
            (select count(*)::int from app.product_aliases) as aliases`,
  );
  console.log(
    `${saved} itens gravados (${skipped} ignorados). Memória: ${counts?.products} produtos, ${counts?.aliases} apelidos.`,
  );
} finally {
  await db.close();
}

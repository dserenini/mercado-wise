import type { ItemInterpreted } from "../schemas/interpretation.js";
import type { InterpretationMemory } from "../services/interpreter.js";
import { isManufacturerEan } from "../services/validators.js";
import type { Db } from "./client.js";

const PRODUCT_FIELDS = `p.product, p.brand, p.variant, p.package_size, p.package_unit,
  p.category`;

type ProductRow = Omit<ItemInterpreted, "confidence">;

/**
 * Memória de itens confirmados, na ordem do mais confiável para o menos:
 * 1. EAN do fabricante — vale em qualquer mercado;
 * 2. código interno do mercado (balança/hortifruti) — vale dentro da rede (raiz do CNPJ);
 * 3. descrição crua exatamente igual, dentro da mesma rede.
 */
export function createDbMemory(db: Db): InterpretationMemory {
  return {
    async find(item, store) {
      let row: ProductRow | undefined;

      if (item.ean !== null && isManufacturerEan(item.ean)) {
        [row] = await db.query<ProductRow>(
          `select ${PRODUCT_FIELDS} from app.products p where p.ean = $1`,
          [item.ean],
        );
      }

      const cnpjRoot = store.cnpj?.slice(0, 8);
      if (!row && cnpjRoot?.length === 8 && item.store_code !== null) {
        [row] = await db.query<ProductRow>(
          `select ${PRODUCT_FIELDS}
             from app.product_aliases a join app.products p on p.id = a.product_id
            where a.store_cnpj_root = $1 and a.store_code = $2
            order by a.updated_at desc limit 1`,
          [cnpjRoot, item.store_code],
        );
      }

      if (!row && cnpjRoot?.length === 8 && item.raw_description !== null) {
        [row] = await db.query<ProductRow>(
          `select ${PRODUCT_FIELDS}
             from app.product_aliases a join app.products p on p.id = a.product_id
            where a.store_cnpj_root = $1 and a.raw_description = $2`,
          [cnpjRoot, item.raw_description],
        );
      }

      return row ? { ...row, confidence: "high" } : null;
    },
  };
}

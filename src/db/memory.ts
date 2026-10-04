import type {
  InterpretationMemory,
  RememberedItem,
} from "../services/interpreter.js";
import { isManufacturerEan } from "../services/validators.js";
import type { Db } from "./client.js";

const PRODUCT_FIELDS = `p.product, p.brand, p.variant, p.package_size, p.package_unit,
  p.category`;

type ProductRow = Omit<RememberedItem, "confidence">;

/**
 * Memória de itens confirmados, na ordem do mais confiável para o menos:
 * 1. EAN do fabricante — vale em qualquer mercado;
 * 2. código interno do mercado (balança/hortifruti) — vale dentro da rede (raiz do CNPJ);
 * 3. descrição crua igual (ignorando pontuação e o "kg" do fim), dentro da mesma rede.
 * Devolve também como o mercado escreve o item (de preferência a mesma rede), usado
 * para sugerir a descrição quando ela saiu ilegível na foto.
 */
export function createDbMemory(db: Db): InterpretationMemory {
  return {
    async find(item, store) {
      let row: ProductRow | undefined;

      const cnpjRoot = store.cnpj?.slice(0, 8);
      if (item.ean !== null && isManufacturerEan(item.ean)) {
        [row] = await db.query<ProductRow>(
          `select ${PRODUCT_FIELDS},
                  (select a.raw_description from app.product_aliases a
                    where a.product_id = p.id
                    order by a.store_cnpj_root = $2 desc, a.updated_at desc
                    limit 1) as raw_description
             from app.products p where p.ean = $1`,
          [item.ean, cnpjRoot ?? ""],
        );
      }

      if (!row && cnpjRoot?.length === 8 && item.store_code !== null) {
        [row] = await db.query<ProductRow>(
          `select ${PRODUCT_FIELDS}, a.raw_description
             from app.product_aliases a join app.products p on p.id = a.product_id
            where a.store_cnpj_root = $1 and a.store_code = $2
            order by a.updated_at desc limit 1`,
          [cnpjRoot, item.store_code],
        );
      }

      if (!row && cnpjRoot?.length === 8 && item.raw_description !== null) {
        [row] = await db.query<ProductRow>(
          `select ${PRODUCT_FIELDS}, a.raw_description
             from app.product_aliases a join app.products p on p.id = a.product_id
            where a.store_cnpj_root = $1
              and a.description_key = app.description_key($2)`,
          [cnpjRoot, item.raw_description],
        );
      }

      return row ? { ...row, confidence: "high" } : null;
    },
  };
}

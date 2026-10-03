import type { Db } from "../db/client.js";
import { createDbMemory } from "../db/memory.js";
import type { ItemRow, ReceiptRow } from "../db/receipts-repo.js";
import type { InterpretationMemory } from "./interpreter.js";

/**
 * Ao abrir um rascunho, reaplica a memória: o que foi confirmado em outras notas
 * depois que este rascunho foi interpretado passa a aparecer aqui. Só os campos de
 * produto mudam (preço, quantidade e EAN são desta nota), e itens que o usuário já
 * editou ficam como estão. Não grava nada: a confirmação grava o que a tela mostra.
 */
export async function withMemory<
  T extends { receipt: ReceiptRow; items: ItemRow[] },
>(
  db: Db,
  saved: T,
  memory: InterpretationMemory = createDbMemory(db),
): Promise<T> {
  if (saved.receipt.status !== "draft") return saved;
  const store = {
    name: saved.receipt.store_name,
    cnpj: saved.receipt.store_cnpj,
  };

  const items = await Promise.all(
    saved.items.map(async (item) => {
      if (item.edited_by_user || item.interpretation_source === "user")
        return item;
      if (item.raw_description === null) return item;
      const remembered = await memory.find(
        {
          raw_description: item.raw_description,
          ean: item.ean,
          store_code: item.store_code,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: null,
          total_price: null,
          discount: null,
        },
        store,
      );
      if (!remembered) return item;
      return {
        ...item,
        product: remembered.product,
        brand: remembered.brand,
        variant: remembered.variant,
        package_size: remembered.package_size,
        package_unit: remembered.package_unit,
        category: remembered.category,
        confidence: "high",
        interpretation_source: "memory",
      };
    }),
  );
  return { ...saved, items };
}

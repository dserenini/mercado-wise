import type { Db } from "../db/client.js";
import { createDbMemory } from "../db/memory.js";
import type { ItemRow, ReceiptRow } from "../db/receipts-repo.js";
import { toCents } from "../lib/money.js";
import { annotate, completeLine } from "./derive.js";
import type { InterpretationMemory, RememberedItem } from "./interpreter.js";
import { problemsStatus, validateItem } from "./validators.js";

/**
 * Ao abrir um rascunho, reaplica a memória: o que foi confirmado em outras notas
 * depois que este rascunho foi interpretado passa a aparecer aqui. Só os campos de
 * produto mudam (preço, quantidade e EAN são desta nota), e itens que o usuário já
 * editou ficam como estão. Não grava nada: a confirmação grava o que a tela mostra.
 *
 * Item com descrição ilegível mas com EAN ou código interno: a memória busca pelo
 * código e preenche também a descrição, como **sugestão** (`suggested`), com
 * confiança média, para a tela pedir conferência.
 */
export async function withMemory<
  T extends { receipt: ReceiptRow; items: ItemRow[] },
>(
  db: Db,
  saved: T,
  memory: InterpretationMemory = createDbMemory(db),
): Promise<T> {
  if (saved.receipt.status === "confirmed") return saved;
  const store = {
    name: saved.receipt.store_name,
    cnpj: saved.receipt.store_cnpj,
  };

  const items = await Promise.all(
    saved.items.map(async (item) => {
      if (item.edited_by_user || item.interpretation_source === "user")
        return item;
      const illegible = item.raw_description === null;
      if (illegible && item.ean === null && item.store_code === null)
        return item;
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
      if (illegible)
        return {
          ...item,
          ...productFields(remembered),
          raw_description: remembered.raw_description ?? null,
          confidence: "medium",
          interpretation_source: "memory",
          suggested: true,
        };
      return {
        ...item,
        ...productFields(remembered),
        confidence: "high",
        interpretation_source: "memory",
      };
    }),
  );
  return { ...saved, items };
}

function productFields(r: RememberedItem) {
  return {
    product: r.product,
    brand: r.brand,
    variant: r.variant,
    package_size: r.package_size,
    package_unit: r.package_unit,
    category: r.category,
  };
}

/**
 * Rascunho gravado antes de existir a conta automática (ou com item ainda não
 * editado): completa quantidade, preço ou total que saem da conta com uma resposta só
 * (ver services/derive.ts) e refaz os avisos do item. Não grava nada.
 */
export function withLineMath<
  T extends { receipt: ReceiptRow; items: ItemRow[] },
>(saved: T): T {
  if (saved.receipt.status === "confirmed") return saved;
  const reais = (c: number | null) => (c === null ? null : c / 100);
  const cents = (v: number | null) => (v === null ? null : toCents(v));

  const items = saved.items.map((row, index) => {
    if (row.edited_by_user) return row;
    const line = completeLine({
      raw_description: row.raw_description,
      ean: row.ean,
      store_code: row.store_code,
      quantity: row.quantity,
      unit: row.unit,
      unit_price: reais(row.unit_price_cents),
      total_price: reais(row.total_price_cents),
      discount: reais(row.discount_cents),
    });
    if (!line.completed && !line.ambiguous) return row;
    const { problems } = validateItem(line.item, index);
    const check_problems = annotate(problems, line);
    return {
      ...row,
      quantity: line.item.quantity,
      unit_price_cents: cents(line.item.unit_price),
      total_price_cents: cents(line.item.total_price),
      check_problems,
      check_status: problemsStatus(check_problems),
    };
  });
  return { ...saved, items };
}

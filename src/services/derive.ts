import { formatCents, toCents } from "../lib/money.js";
import type { ItemRead, ReceiptRead } from "../schemas/receipt.js";
import type { Problem } from "./validators.js";

// Completa a conta da linha: com dois de (quantidade, preço unitário, total), o
// terceiro sai pela conta — mas só quando há UMA resposta possível. Item pesado tem
// o total impresso truncado ou arredondado (cada mercado faz de um jeito), então um
// total pode vir de mais de um peso ou preço; aí não se preenche, só se avisa.

export type LineField = "quantity" | "unit_price" | "total_price";

export interface LineCompletion {
  field: LineField;
  /** como o valor saiu, para mostrar na revisão: "8,07 ÷ 21,80" */
  note: string;
}

export interface LineOutcome {
  item: ItemRead;
  /** o campo que foi preenchido pela conta */
  completed: LineCompletion | null;
  /** a conta tem mais de uma resposta: a mensagem lista as possíveis */
  ambiguous: string | null;
  /** total ilegível com mais de um valor possível (centavos), para o total da nota decidir */
  totalOptions?: number[];
}

const isWeight = (unit: string | null) => /^kg$/i.test(unit?.trim() ?? "");
const num = (n: number, digits: number) =>
  n.toFixed(digits).replace(".", ",").replace(/,?0+$/, "");

/** O total que a nota imprimiria para qtd × preço (centavos), truncando ou arredondando. */
function printedTotals(quantity: number, unitCents: number): Set<number> {
  const exact = quantity * unitCents;
  // 1e-6 absorve o erro de ponto flutuante (0,1 × 3 = 0,30000000000000004)
  return new Set([Math.floor(exact + 1e-6), Math.round(exact)]);
}

export function completeLine(item: ItemRead): LineOutcome {
  const { quantity, unit_price, total_price } = item;
  const missing = [quantity, unit_price, total_price].filter(
    (v) => v === null,
  ).length;
  const none = { item, completed: null, ambiguous: null };
  if (missing !== 1) return none;

  const weight = isWeight(item.unit);
  const unitCents = unit_price === null ? null : toCents(unit_price);
  const totalCents = total_price === null ? null : toCents(total_price);

  // --- Falta o total ---
  if (totalCents === null && quantity !== null && unitCents !== null) {
    if (quantity <= 0) return none;
    const options = [...printedTotals(quantity, unitCents)];
    const note = `${num(quantity, 3)} × ${formatCents(unitCents)}`;
    if (options.length === 1)
      return fill(item, "total_price", (options[0] ?? 0) / 100, note);
    return {
      ...none,
      ambiguous: `Total ilegível: pela conta (${note}) seria ${options.map(formatCents).join(" ou ")}`,
      totalOptions: options,
    };
  }

  // --- Falta a quantidade ---
  if (quantity === null && unitCents !== null && totalCents !== null) {
    if (unitCents <= 0 || totalCents <= 0) return none;
    const note = `${formatCents(totalCents)} ÷ ${formatCents(unitCents)}`;
    if (!weight) {
      const q = totalCents / unitCents;
      return Number.isInteger(q) ? fill(item, "quantity", q, note) : none;
    }
    // peso em gramas inteiras (3 casas em kg) que reproduz o total impresso
    const grams: number[] = [];
    // todo peso com |g/1000 × preço − total| < 1 centavo (cobre truncar e arredondar)
    const lo = Math.floor(((totalCents - 1) / unitCents) * 1000);
    const hi = Math.ceil(((totalCents + 1) / unitCents) * 1000);
    for (let g = lo; g <= hi; g++) {
      if (g > 0 && printedTotals(g / 1000, unitCents).has(totalCents))
        grams.push(g);
    }
    if (grams.length === 1)
      return fill(item, "quantity", (grams[0] ?? 0) / 1000, note);
    if (grams.length > 1)
      return {
        ...none,
        ambiguous: `Quantidade: pela conta (${note}) pode ser ${grams.map((g) => `${num(g / 1000, 3)} kg`).join(", ")}`,
      };
    return none;
  }

  // --- Falta o preço unitário ---
  if (unitCents === null && quantity !== null && totalCents !== null) {
    if (quantity <= 0) return none;
    const note = `${formatCents(totalCents)} ÷ ${num(quantity, 3)}`;
    if (!weight) {
      const p = totalCents / quantity;
      return Number.isInteger(p)
        ? fill(item, "unit_price", p / 100, note)
        : none;
    }
    const prices: number[] = [];
    const lo = Math.floor((totalCents - 1) / quantity);
    const hi = Math.ceil((totalCents + 1) / quantity);
    for (let p = lo; p <= hi; p++) {
      if (p > 0 && printedTotals(quantity, p).has(totalCents)) prices.push(p);
    }
    if (prices.length === 1)
      return fill(item, "unit_price", (prices[0] ?? 0) / 100, note);
    if (prices.length > 1)
      return {
        ...none,
        ambiguous: `Preço unitário: pela conta (${note}) pode ser ${formatCents(prices[0] ?? 0)} a ${formatCents(prices.at(-1) ?? 0)}`,
      };
  }
  return none;
}

function fill(
  item: ItemRead,
  field: LineField,
  value: number,
  note: string,
): LineOutcome {
  return {
    item: { ...item, [field]: value },
    completed: { field, note },
    ambiguous: null,
  };
}

/**
 * Completa todas as linhas da nota (ver completeLine). Se sobrar um único total de
 * linha em dúvida (truncar ou arredondar), o total da nota decide: o valor que faz a
 * soma fechar.
 */
export function completeLines(receipt: ReceiptRead): {
  receipt: ReceiptRead;
  lines: LineOutcome[];
} {
  const lines = receipt.items.map(completeLine);
  const open = lines.filter((l) => l.item.total_price === null);
  const [only] = open;
  if (open.length === 1 && only?.totalOptions && receipt.total !== null) {
    const cents = (v: number | null) => (v === null ? 0 : toCents(v));
    const discounts =
      receipt.discount_total !== null
        ? toCents(receipt.discount_total)
        : lines.reduce((acc, l) => acc + cents(l.item.discount), 0);
    const others = lines.reduce((acc, l) => acc + cents(l.item.total_price), 0);
    const needed = toCents(receipt.total) + discounts - others;
    if (only.totalOptions.includes(needed)) {
      const index = lines.indexOf(only);
      const { quantity, unit_price } = only.item;
      lines[index] = fill(
        only.item,
        "total_price",
        needed / 100,
        `${num(quantity ?? 0, 3)} × ${formatCents(toCents(unit_price ?? 0))}, fechando com o total da nota`,
      );
    }
  }
  return { receipt: { ...receipt, items: lines.map((l) => l.item) }, lines };
}

/**
 * Junta à validação do item o que a conta fez: nota "calculado" (info) no campo
 * preenchido, ou a lista de valores possíveis no lugar do aviso genérico.
 */
export function annotate(problems: Problem[], line: LineOutcome): Problem[] {
  if (line.completed) {
    const { field, note } = line.completed;
    const message = `${FIELD_LABEL[field]} calculado: ${note}`;
    return [...problems, { severity: "info", message }];
  }
  // total em dúvida: o aviso "Total ilegível; pela conta seria…" da validação já cobre
  if (line.ambiguous && line.totalOptions === undefined)
    return [
      ...problems.filter((p) => !p.message.startsWith("Faltou quantidade")),
      { severity: "warning", message: line.ambiguous },
    ];
  return problems;
}

export const FIELD_LABEL: Record<LineField, string> = {
  quantity: "Quantidade",
  unit_price: "Preço unitário",
  total_price: "Total",
};

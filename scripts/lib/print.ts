import type { ItemRead } from "../../src/schemas/receipt.js";
import type { InterpretedItem } from "../../src/services/interpreter.js";

const CONFIDENCE = { high: "", medium: "~", low: "⚠" } as const;

function cell(value: string | null | undefined, width: number): string {
  const text = value ?? "—";
  return text.length > width
    ? `${text.slice(0, width - 1)}…`
    : text.padEnd(width);
}

/** Tabela "descrição crua → interpretação", lado a lado. */
export function formatItems(
  items: ItemRead[],
  interpreted: (InterpretedItem | null)[],
): string {
  const header = `${"#".padStart(3)}  ${cell("Na nota", 22)}  ${cell("Produto", 26)}  ${cell("Marca", 14)}  ${cell("Variante", 18)}  ${cell("Emb.", 8)}  ${cell("Categoria", 18)}`;
  const rows = items.map((item, i) => {
    const it = interpreted[i];
    const pkg =
      it?.package_size != null
        ? `${it.package_size} ${it.package_unit ?? ""}`.trim()
        : null;
    const mark = it ? CONFIDENCE[it.confidence] : "?";
    return `${String(i + 1).padStart(3)}${mark.padStart(2)}${cell(item.raw_description, 22)}  ${cell(it?.product, 26)}  ${cell(it?.brand, 14)}  ${cell(it?.variant, 18)}  ${cell(pkg, 8)}  ${cell(it?.category, 18)}`;
  });
  return [
    header,
    ...rows,
    "(~ confiança média, ⚠ baixa, ? sem interpretação)",
  ].join("\n");
}

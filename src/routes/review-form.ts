import type { ConfirmedHeader, ConfirmedItem } from "../db/receipts-repo.js";
import { parseCents, parseDecimal } from "../lib/money.js";
import { CATEGORIES, type Category } from "../schemas/interpretation.js";

// Converte o formulário da tela de revisão (tudo texto, números em formato
// brasileiro) em dados para confirmReceipt. Função pura: fácil de testar.

const PACKAGE_UNITS = ["g", "kg", "ml", "l", "un"] as const;
type PackageUnit = (typeof PACKAGE_UNITS)[number];

export type ReviewForm =
  | { ok: true; header: ConfirmedHeader; items: ConfirmedItem[] }
  | { ok: false; errors: string[] };

export function parseReviewForm(body: Record<string, unknown>): ReviewForm {
  const errors: string[] = [];
  const text = (v: unknown) =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  const number = (v: unknown, label: string) => {
    const value = parseDecimal(text(v) ?? "");
    if (Number.isNaN(value)) errors.push(`${label}: número inválido`);
    return Number.isNaN(value) ? null : value;
  };
  const cents = (v: unknown, label: string) => {
    const value = parseCents(text(v) ?? "");
    if (Number.isNaN(value)) errors.push(`${label}: valor inválido`);
    return Number.isNaN(value) ? null : value;
  };

  const date = text(body.purchase_date);
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    errors.push("Data inválida");
  const header: ConfirmedHeader = {
    store_name: text(body.store_name),
    purchase_date: date,
    total_cents: cents(body.total, "Total da nota"),
    payment_method: text(body.payment_method),
  };

  // O formulário manda items[0][campo], items[1][campo]…; o parser pode entregar
  // um array ou um objeto (quando há índices novos, como "n1"). A ordem é a da tela.
  const raw = body.items;
  const rows = (Array.isArray(raw) ? raw : Object.values(raw ?? {})) as Record<
    string,
    unknown
  >[];
  if (rows.length === 0) errors.push("A nota precisa de pelo menos um item");

  const items = rows.map((row, i): ConfirmedItem => {
    const label = `Item ${i + 1}`;
    const product = text(row.product);
    if (product === null) errors.push(`${label}: informe o produto`);
    const category = text(row.category);
    if (!CATEGORIES.includes(category as Category)) {
      errors.push(`${label}: escolha uma categoria`);
    }
    const packageUnit = text(row.package_unit);
    if (
      packageUnit !== null &&
      !PACKAGE_UNITS.includes(packageUnit as PackageUnit)
    ) {
      errors.push(`${label}: unidade de embalagem inválida`);
    }
    const ean = text(row.ean);
    if (ean !== null && !/^\d+$/.test(ean))
      errors.push(`${label}: EAN só com dígitos`);

    return {
      raw_description: text(row.raw_description),
      ean,
      store_code: text(row.store_code),
      quantity: number(row.quantity, `${label}, quantidade`),
      unit: text(row.unit),
      unit_price_cents: cents(row.unit_price, `${label}, preço unitário`),
      total_price_cents: cents(row.total_price, `${label}, total`),
      discount_cents: cents(row.discount, `${label}, desconto`),
      product: product ?? "",
      brand: text(row.brand),
      variant: text(row.variant),
      package_size: number(row.package_size, `${label}, embalagem`),
      package_unit: packageUnit as PackageUnit | null,
      category: (category ?? "Outros") as Category,
      confidence: "high",
    };
  });

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, header, items };
}

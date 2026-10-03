import type { ItemRead, ReceiptRead } from "../../src/schemas/receipt.js";

// Dados de exemplo válidos (CNPJ e chave de acesso sintéticos, com DVs corretos).
export const VALID_CNPJ = "11222333000181";
export const VALID_ACCESS_KEY = "35250911222333000181650010000123451000123451";

export function item(overrides: Partial<ItemRead> = {}): ItemRead {
  return {
    raw_description: "AG TON SCHW ZERO 350",
    ean: "7894900360042",
    store_code: null,
    quantity: 1,
    unit: "UN",
    unit_price: 3.99,
    total_price: 3.99,
    discount: null,
    ...overrides,
  };
}

export function receipt(overrides: Partial<ReceiptRead> = {}): ReceiptRead {
  return {
    is_receipt: true,
    store: { name: "SUPERMERCADO X", cnpj: VALID_CNPJ, address: null },
    access_key: VALID_ACCESS_KEY,
    purchase_date: "2025-09-30",
    purchase_time: "18:42",
    items: [item()],
    items_count: 1,
    gross_total: 3.99,
    discount_total: null,
    total: 3.99,
    payment_method: "Cartão de Débito",
    quality: { orientation: "ok", flags: [], illegible_lines: [] },
    ...overrides,
  };
}

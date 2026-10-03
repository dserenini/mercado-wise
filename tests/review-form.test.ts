import { describe, expect, it } from "vitest";
import { parseReviewForm } from "../src/routes/review-form.js";

const limao = {
  raw_description: "LIMAO THAITI EX.kg",
  ean: "",
  store_code: "32845",
  quantity: "0,140",
  unit: "kg",
  unit_price: "10,98",
  total_price: "1,54",
  discount: "",
  product: "Limão",
  brand: "",
  variant: "Taiti",
  package_size: "",
  package_unit: "",
  category: "Hortifruti",
};

const body = {
  store_name: "DMA DISTRIBUIDORA S/A",
  purchase_date: "2026-07-25",
  total: "1,54",
  payment_method: "C.DEBITO",
  items: [limao],
};

describe("parseReviewForm", () => {
  it("converte texto em números, centavos e nulos", () => {
    const form = parseReviewForm(body);
    expect(form.ok).toBe(true);
    if (!form.ok) return;
    expect(form.header).toEqual({
      store_name: "DMA DISTRIBUIDORA S/A",
      purchase_date: "2026-07-25",
      total_cents: 154,
      payment_method: "C.DEBITO",
    });
    expect(form.items[0]).toMatchObject({
      ean: null,
      store_code: "32845",
      quantity: 0.14,
      unit_price_cents: 1098,
      total_price_cents: 154,
      discount_cents: null,
      brand: null,
      variant: "Taiti",
      package_size: null,
      category: "Hortifruti",
    });
  });

  it("aceita itens como objeto (índices novos vindos da tela) mantendo a ordem", () => {
    const form = parseReviewForm({
      ...body,
      items: { 0: limao, n1: { ...limao, product: "Banana" } },
    });
    expect(form.ok && form.items.map((i) => i.product)).toEqual([
      "Limão",
      "Banana",
    ]);
  });

  it("aponta cada problema com o número do item", () => {
    const form = parseReviewForm({
      ...body,
      total: "abc",
      items: [
        {
          ...limao,
          product: " ",
          category: "Feira",
          quantity: "1,2x",
          ean: "78A",
        },
      ],
    });
    expect(form.ok).toBe(false);
    if (form.ok) return;
    expect(form.errors).toEqual([
      "Total da nota: valor inválido",
      "Item 1: informe o produto",
      "Item 1: escolha uma categoria",
      "Item 1: EAN só com dígitos",
      "Item 1, quantidade: número inválido",
    ]);
  });

  it("recusa nota sem itens", () => {
    const form = parseReviewForm({ ...body, items: undefined });
    expect(form.ok).toBe(false);
  });
});

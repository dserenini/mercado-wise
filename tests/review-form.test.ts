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

  it("marca a linha copiada de outra igual pela tela", () => {
    const form = parseReviewForm({
      ...body,
      items: [limao, { ...limao, copied: "1" }],
    });
    expect(form.ok && form.items.map((i) => i.copied)).toEqual([false, true]);
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

describe("ordem dos itens", () => {
  it("salva na ordem da nota mesmo com itens do topo vindo antes no formulário", async () => {
    const qs = await import("qs");
    // A tela manda primeiro os itens de "Faltou informação" (4 e 22), depois os demais.
    const order = [
      4,
      22,
      ...Array.from({ length: 25 }, (_, i) => i).filter(
        (i) => i !== 4 && i !== 22,
      ),
    ];
    const encoded = [
      "store_name=X&total=1,54",
      ...order.map(
        (i) =>
          `items[${i}][raw_description]=I${i}&items[${i}][product]=P&items[${i}][category]=Outros`,
      ),
    ].join("&");
    const form = parseReviewForm(qs.parse(encoded, { parameterLimit: 10_000 }));
    expect(form.ok).toBe(true);
    if (!form.ok) return;
    expect(form.items.map((i) => i.raw_description)).toEqual(
      Array.from({ length: 25 }, (_, i) => `I${i}`),
    );
  });
});

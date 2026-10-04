import { describe, expect, it } from "vitest";
import { completeLine, completeLines } from "../src/services/derive.js";
import { item, receipt } from "./helpers/receipt.js";

const pesado = (overrides = {}) =>
  item({ ean: null, store_code: "42858", unit: "KG", ...overrides });

describe("completeLine", () => {
  it("quantidade de item pesado: o único peso que dá o total (8,07 ÷ 21,80)", () => {
    const r = completeLine(
      pesado({ quantity: null, unit_price: 21.8, total_price: 8.07 }),
    );
    expect(r.item.quantity).toBe(0.37);
    expect(r.completed).toEqual({
      field: "quantity",
      note: "R$ 8,07 ÷ R$ 21,80",
    });
  });

  it("não preenche peso quando mais de um dá o mesmo total (banana a 3,98/kg)", () => {
    const r = completeLine(
      pesado({ quantity: null, unit_price: 3.98, total_price: 7.44 }),
    );
    expect(r.item.quantity).toBeNull();
    expect(r.ambiguous).toContain("1,869 kg");
    expect(r.ambiguous).toContain("1,87 kg");
  });

  it("quantidade por unidade só se a divisão for exata", () => {
    expect(
      completeLine(
        item({ quantity: null, unit_price: 8.99, total_price: 26.97 }),
      ).item.quantity,
    ).toBe(3);
    expect(
      completeLine(item({ quantity: null, unit_price: 8.99, total_price: 20 }))
        .completed,
    ).toBeNull();
  });

  it("total por unidade: qtd × preço", () => {
    const r = completeLine(
      item({ quantity: 3, unit_price: 5.48, total_price: null }),
    );
    expect(r.item.total_price).toBe(16.44);
  });

  it("total de item pesado em dúvida (truncar × arredondar) fica em aberto", () => {
    // 0,457 × 3,98 = 1,81886: trunca 1,81, arredonda 1,82
    const r = completeLine(
      pesado({ quantity: 0.457, unit_price: 3.98, total_price: null }),
    );
    expect(r.completed).toBeNull();
    expect(r.totalOptions).toEqual([181, 182]);
  });

  it("total de item pesado sem dúvida (0,455 × 3,98 = 1,8109 → 1,81)", () => {
    const r = completeLine(
      pesado({ quantity: 0.455, unit_price: 3.98, total_price: null }),
    );
    expect(r.item.total_price).toBe(1.81);
  });

  it("preço unitário de item pesado com várias respostas não é preenchido", () => {
    const r = completeLine(
      pesado({ quantity: 0.36, unit_price: null, total_price: 7.85 }),
    );
    expect(r.item.unit_price).toBeNull();
    expect(r.ambiguous).toContain("Preço unitário");
  });

  it("com dois campos faltando, não inventa nada", () => {
    const r = completeLine(
      item({ quantity: null, unit_price: null, total_price: 3.99 }),
    );
    expect(r).toMatchObject({ completed: null, ambiguous: null });
  });
});

describe("completeLines", () => {
  it("total da nota decide o total de linha em dúvida", () => {
    // 0,457 × 3,98 = 1,81886: 1,81 ou 1,82; a nota (5,81) só fecha com 1,82
    const r = completeLines(
      receipt({
        items: [
          item({ quantity: 1, unit_price: 3.99, total_price: 3.99 }),
          pesado({ quantity: 0.457, unit_price: 3.98, total_price: null }),
        ],
        total: 5.81,
      }),
    );
    expect(r.receipt.items[1]?.total_price).toBe(1.82);
    expect(r.lines[1]?.completed?.note).toContain("total da nota");
  });
});

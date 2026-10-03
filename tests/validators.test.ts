import { describe, expect, it } from "vitest";
import {
  isValidAccessKey,
  isValidCnpj,
  isValidGtin,
  validateItem,
  validateReceipt,
} from "../src/services/validators.js";
import { item, receipt, VALID_ACCESS_KEY } from "./helpers/receipt.js";

describe("isValidGtin", () => {
  // Casos portados de legacy-v0: backend/tests/test_gtin.py
  it.each([
    ["7891000100103", true], // EAN-13
    ["12345670", true], // EAN-8
    ["7894900360042", true],
    ["7894900360043", false], // DV trocado
    ["7894904015106", false], // 8 lido como 6 (o certo é ...108), erro comum em térmica
    ["70847022206", true], // UPC impresso sem o zero à esquerda (070847022206)
    ["7891000100103123", false], // longo demais
    ["789100010010X", false], // não-dígito
    ["", false],
    ["123", false],
  ])("%s → %s", (code, ok) => {
    expect(isValidGtin(code)).toBe(ok);
  });
});

describe("isValidCnpj", () => {
  it.each([
    ["11222333000181", true],
    ["11222333000182", false], // DV trocado
    ["11111111111111", false], // todos iguais passam no cálculo, mas são inválidos
    ["1122233300018", false], // 13 dígitos
  ])("%s → %s", (cnpj, ok) => {
    expect(isValidCnpj(cnpj)).toBe(ok);
  });
});

describe("isValidAccessKey", () => {
  it("aceita chave com DV correto (conferido com a implementação Python do legado)", () => {
    expect(isValidAccessKey(VALID_ACCESS_KEY)).toBe(true);
  });

  it("recusa um dígito trocado no meio", () => {
    const wrong = `${VALID_ACCESS_KEY.slice(0, 20)}9${VALID_ACCESS_KEY.slice(21)}`;
    expect(isValidAccessKey(wrong)).toBe(false);
  });

  it("recusa tamanho errado", () => {
    expect(isValidAccessKey(VALID_ACCESS_KEY.slice(1))).toBe(false);
  });
});

describe("validateItem", () => {
  it("item conferido não tem problemas", () => {
    expect(validateItem(item(), 0)).toMatchObject({
      ean: "ok",
      arithmetic: "ok",
      problems: [],
    });
  });

  it("aceita item pesado com total truncado (0,455 kg × 3,98 = 1,8109 → 1,81)", () => {
    const weighed = item({
      ean: null,
      store_code: "32836",
      quantity: 0.455,
      unit: "kg",
      unit_price: 3.98,
      total_price: 1.81,
    });
    const v = validateItem(weighed, 0);
    expect(v.arithmetic).toBe("ok");
    expect(v.problems).toEqual([]);
  });

  it("acusa conta da linha que não fecha", () => {
    const v = validateItem(
      item({ quantity: 2, unit_price: 9.98, total_price: 19.86 }),
      0,
    );
    expect(v.arithmetic).toBe("fail");
    expect(v.problems[0]?.severity).toBe("error");
  });

  it("acusa EAN com dígito verificador errado", () => {
    expect(validateItem(item({ ean: "7894900360043" }), 0).ean).toBe("fail");
  });

  it("avisa quando falta dado para conferir", () => {
    const v = validateItem(item({ unit_price: null }), 0);
    expect(v.arithmetic).toBe("unknown");
    expect(v.problems[0]?.severity).toBe("warning");
  });

  it("avisa quando não há código nenhum", () => {
    const v = validateItem(item({ ean: null, store_code: null }), 0);
    expect(v.problems.map((p) => p.severity)).toEqual(["warning"]);
  });
});

describe("validateReceipt", () => {
  it("nota toda conferida fica verde", () => {
    const v = validateReceipt(receipt());
    expect(v.trafficLight).toBe("green");
    expect(v.checks).toMatchObject({
      total: "ok",
      itemsCount: "ok",
      cnpj: "ok",
      accessKey: "ok",
      cnpjMatchesKey: "ok",
      dateMatchesKey: "ok",
    });
  });

  it("soma sem erro de ponto flutuante (0,10 + 0,20 = 0,30)", () => {
    const v = validateReceipt(
      receipt({
        items: [
          item({ unit_price: 0.1, total_price: 0.1 }),
          item({ unit_price: 0.2, total_price: 0.2 }),
        ],
        items_count: 2,
        total: 0.3,
      }),
    );
    expect(v.checks.total).toBe("ok");
  });

  it("subtrai os descontos dos itens quando não há desconto total impresso", () => {
    const v = validateReceipt(
      receipt({
        items: [
          item({ quantity: 2, unit_price: 5, total_price: 10, discount: 1.5 }),
        ],
        gross_total: 10,
        total: 8.5,
      }),
    );
    expect(v.checks.total).toBe("ok");
    expect(v.checks.grossTotal).toBe("ok");
    expect(v.expectedTotalCents).toBe(850);
  });

  it("usa o desconto total impresso quando existe", () => {
    const v = validateReceipt(
      receipt({
        items: [item({ quantity: 2, unit_price: 5, total_price: 10 })],
        gross_total: 10,
        discount_total: 2,
        total: 8,
      }),
    );
    expect(v.checks.total).toBe("ok");
  });

  it("total que não fecha por 1 centavo fica amarelo, com a diferença", () => {
    const v = validateReceipt(receipt({ total: 4.0 }));
    expect(v.checks.total).toBe("fail");
    expect(v.totalDiffCents).toBe(1);
    expect(v.trafficLight).toBe("yellow");
  });

  it("total muito longe da soma fica vermelho", () => {
    expect(validateReceipt(receipt({ total: 30 })).trafficLight).toBe("red");
  });

  it("acusa quantidade de itens diferente da impressa", () => {
    const v = validateReceipt(receipt({ items_count: 2 }));
    expect(v.checks.itemsCount).toBe("fail");
    expect(v.trafficLight).toBe("yellow");
  });

  it("aceita 'Qtd. total de itens' como soma das unidades (item pesado conta 1)", () => {
    const v = validateReceipt(
      receipt({
        items: [
          item({ quantity: 3, unit_price: 2.79, total_price: 8.37 }),
          item({
            ean: null,
            store_code: "67416",
            quantity: 0.47,
            unit: "kg",
            unit_price: 7.98,
            total_price: 3.75,
          }),
        ],
        items_count: 4,
        total: 12.12,
      }),
    );
    expect(v.checks.itemsCount).toBe("ok");
  });

  it("sugere o total de item ilegível e não deixa a nota vermelha se ele explica a diferença", () => {
    // Nota 5: "CORONA CERO 350ML 3 UN X 5,48" com o total apagado na foto (16,44).
    const v = validateReceipt(
      receipt({
        items: [
          item({ quantity: 6, unit_price: 6.18, total_price: 37.08 }),
          item({ quantity: 3, unit_price: 5.48, total_price: null }),
        ],
        items_count: 2,
        total: 53.52,
      }),
    );
    expect(v.items[1]?.suggestedTotalCents).toBe(1644);
    expect(v.checks.total).toBe("fail");
    expect(v.totalExplainedBySuggestions).toBe(true);
    expect(v.trafficLight).toBe("yellow");
  });

  it("acusa data que não bate com a chave de acesso", () => {
    const v = validateReceipt(receipt({ purchase_date: "2025-10-01" }));
    expect(v.checks.dateMatchesKey).toBe("fail");
    expect(v.trafficLight).toBe("yellow");
  });

  it("sem total legível nunca fica verde", () => {
    const v = validateReceipt(receipt({ total: null }));
    expect(v.checks.total).toBe("unknown");
    expect(v.trafficLight).toBe("yellow");
  });

  it("foto que não é cupom fica vermelha", () => {
    expect(
      validateReceipt(receipt({ is_receipt: false, items: [] })).trafficLight,
    ).toBe("red");
  });

  it("mais de 3 itens com erro fica vermelho", () => {
    const bad = item({ quantity: 2, unit_price: 1, total_price: 3 });
    const v = validateReceipt(
      receipt({ items: [bad, bad, bad, bad], items_count: 4, total: 12 }),
    );
    expect(v.trafficLight).toBe("red");
  });
});

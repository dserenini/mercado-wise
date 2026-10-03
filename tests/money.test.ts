import { describe, expect, it } from "vitest";
import {
  centsToInput,
  decimalToInput,
  formatCents,
  parseCents,
  parseDecimal,
  toCents,
} from "../src/lib/money.js";

describe("toCents", () => {
  it("absorve o erro de ponto flutuante", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(72.23)).toBe(7223);
    expect(toCents(19.96)).toBe(1996);
  });
});

describe("formatCents", () => {
  it("formata em reais", () => {
    expect(formatCents(7223)).toBe("R$ 72,23");
    expect(formatCents(5)).toBe("R$ 0,05");
    expect(formatCents(123456)).toBe("R$ 1.234,56");
    expect(formatCents(-150)).toBe("-R$ 1,50");
  });
});

describe("parseDecimal / parseCents", () => {
  it.each([
    ["12,99", 12.99],
    ["1.234,56", 1234.56],
    ["12.99", 12.99],
    ["R$ 5", 5],
    ["0,455", 0.455],
    ["", null],
    ["  ", null],
  ])("%s → %s", (text, value) => {
    expect(parseDecimal(text)).toBe(value);
  });

  it("texto inválido vira NaN (para o formulário acusar)", () => {
    expect(parseDecimal("12,9x")).toBeNaN();
    expect(parseCents("abc")).toBeNaN();
  });

  it("converte reais em centavos", () => {
    expect(parseCents("16,44")).toBe(1644);
    expect(parseCents("")).toBeNull();
  });
});

describe("centsToInput / decimalToInput", () => {
  it("formata para os campos do formulário e volta igual", () => {
    expect(centsToInput(1299)).toBe("12,99");
    expect(centsToInput(5)).toBe("0,05");
    expect(centsToInput(null)).toBe("");
    expect(decimalToInput(0.455)).toBe("0,455");
    expect(parseCents(centsToInput(123456))).toBe(123456);
  });
});

import { describe, expect, it } from "vitest";
import { formatCents, toCents } from "../src/lib/money.js";

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

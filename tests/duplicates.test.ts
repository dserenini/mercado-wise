import { describe, expect, it } from "vitest";
import { compareNotes, type NoteFacts } from "../src/services/duplicates.js";
import { VALID_ACCESS_KEY } from "./helpers/receipt.js";

const items = (n: number, prefix = "item") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

function note(overrides: Partial<NoteFacts> = {}): NoteFacts {
  return {
    id: 1,
    accessKey: null,
    cnpj: "01928075010324",
    storeName: "DMA DISTRIBUIDORA S/A",
    date: "2026-08-23",
    totalCents: 10000,
    payment: "Cartão de Crédito",
    itemKeys: items(10),
    ...overrides,
  };
}

describe("compareNotes", () => {
  it("exemplo do usuário: 8 de 10 itens iguais e valor 19% menor → repetida", () => {
    const b = note({
      id: 2,
      totalCents: 8100,
      itemKeys: [...items(8), "outro1", "outro2"],
      payment: "CARTAO DE CREDITO", // sem acento e em maiúsculas: igual
    });
    const verdict = compareNotes(note(), b);
    expect(verdict).toMatchObject({ duplicate: true });
    if (verdict.duplicate)
      expect(verdict.reason).toBe(
        "8 de 10 itens iguais · valor 19% diferente (R$ 100,00 × R$ 81,00) · mesmo dia · mesmo mercado · mesmo pagamento",
      );
  });

  it("menos de 80% dos itens iguais → diferentes", () => {
    const b = note({ itemKeys: [...items(7), "x", "y", "z"] });
    expect(compareNotes(note(), b)).toEqual({
      duplicate: false,
      failed: "só 7 de 10 itens iguais",
    });
  });

  it("a porcentagem é sobre a nota com mais itens", () => {
    const b = note({ itemKeys: [...items(10), ...items(20, "extra")] });
    expect(compareNotes(note(), b).duplicate).toBe(false);
  });

  it("valor mais de 20% diferente → diferentes", () => {
    expect(compareNotes(note(), note({ totalCents: 7900 }))).toMatchObject({
      duplicate: false,
      failed: "valor 21% diferente",
    });
  });

  it("data, mercado ou pagamento diferentes → diferentes", () => {
    expect(compareNotes(note(), note({ date: "2026-08-24" })).duplicate).toBe(
      false,
    );
    expect(
      compareNotes(note(), note({ cnpj: "45543915047730" })).duplicate,
    ).toBe(false);
    expect(compareNotes(note(), note({ payment: "Pix" })).duplicate).toBe(
      false,
    );
  });

  it("dado ausente não reprova (segue para o próximo)", () => {
    const verdict = compareNotes(
      note(),
      note({ totalCents: null, payment: null, date: null }),
    );
    expect(verdict.duplicate).toBe(true);
    if (verdict.duplicate)
      expect(verdict.reason).toContain("pagamento sem comparação");
  });

  it("mercado pelo nome quando falta o CNPJ de um lado", () => {
    const b = note({ cnpj: null, storeName: "dma distribuidora s/a" });
    expect(compareNotes(note(), b).duplicate).toBe(true);
  });

  it("sem itens para comparar, não marca como repetida", () => {
    expect(compareNotes(note(), note({ itemKeys: [] })).duplicate).toBe(false);
  });

  it("chaves de acesso válidas e diferentes → notas diferentes", () => {
    const other = withCheckDigit(`${VALID_ACCESS_KEY.slice(0, 34)}000000009`);
    const a = note({ accessKey: VALID_ACCESS_KEY });
    expect(compareNotes(a, note({ accessKey: other }))).toEqual({
      duplicate: false,
      failed: "chaves de acesso diferentes",
    });
  });

  it("chave ilegível (DV errado) conta como ausente: a comparação segue", () => {
    const broken = `${VALID_ACCESS_KEY.slice(0, 43)}0`;
    const a = note({ accessKey: VALID_ACCESS_KEY });
    expect(compareNotes(a, note({ accessKey: broken })).duplicate).toBe(true);
  });
});

/** Completa 43 dígitos com o DV da chave de acesso (módulo 11, pesos 2..9). */
function withCheckDigit(body: string): string {
  const sum = [...body]
    .reverse()
    .reduce((acc, d, i) => acc + Number(d) * ((i % 8) + 2), 0);
  const rest = sum % 11;
  return `${body}${rest < 2 ? 0 : 11 - rest}`;
}

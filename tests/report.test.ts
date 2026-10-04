import { describe, expect, it } from "vitest";
import { confirmReceipt, saveDraft } from "../src/db/receipts-repo.js";
import { loadReportNotes } from "../src/db/report-repo.js";
import type { InterpretedItem } from "../src/services/interpreter.js";
import {
  alignLines,
  type ConfirmedLine,
  callsCost,
  type NoteInput,
  reportNote,
  summarize,
} from "../src/services/report.js";
import { validateReceipt } from "../src/services/validators.js";
import { testDb } from "./helpers/db.js";
import { item, receipt } from "./helpers/receipt.js";

const monster = (
  overrides: Partial<InterpretedItem> = {},
): InterpretedItem => ({
  product: "Energético",
  brand: "Monster",
  variant: null,
  package_size: null,
  package_unit: null,
  category: "Bebidas",
  confidence: "high",
  source: "ai",
  ...overrides,
});

function line(overrides: Partial<ConfirmedLine> = {}): ConfirmedLine {
  return {
    raw_description: "AG TON SCHW ZERO 350",
    quantity: 1,
    unit_price_cents: 399,
    total_price_cents: 399,
    product: "Energético",
    brand: "Monster",
    variant: null,
    ...overrides,
  };
}

function note(overrides: Partial<NoteInput> = {}): NoteInput {
  return {
    id: 1,
    storeName: "MERCADO",
    read: receipt(),
    interpreted: [monster()],
    confirmed: [line()],
    calls: [
      {
        model: "claude-sonnet-5-5",
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        latencyMs: 30_000,
      },
    ],
    ...overrides,
  };
}

describe("alignLines", () => {
  it("pareia descrições iguais e o resto por posição", () => {
    expect(alignLines(["A", "B", "C"], ["A", "B x", "C"])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it("detecta linha incluída e linha removida", () => {
    expect(alignLines(["A", "B", "C"], ["A", "C", "D"])).toEqual([
      [0, 0],
      [1, null],
      [2, 1],
      [null, 2],
    ]);
  });

  it("ignora caixa e espaços repetidos", () => {
    expect(alignLines(["leite  integral"], ["LEITE INTEGRAL"])).toEqual([
      [0, 0],
    ]);
  });
});

describe("reportNote", () => {
  it("nota igual ao confirmado: tudo certo e custo calculado", () => {
    const r = reportNote(note());
    expect(r.totalCheck).toBe("ok");
    expect(r.lines).toEqual({ total: 1, correct: 1, problems: [] });
    expect(r.names.ai).toEqual({ total: 1, edited: 0 });
    expect(r.costUsd).toBeCloseTo(2 + 1); // 1 MTok × 2 + 0,1 MTok × 10
    expect(r.latencyMs).toBe(30_000);
  });

  it("acusa preço corrigido e nome corrigido", () => {
    const r = reportNote(
      note({
        interpreted: [monster({ variant: "Ultra" })],
        confirmed: [line({ unit_price_cents: 499, total_price_cents: 499 })],
      }),
    );
    expect(r.lines.correct).toBe(0);
    expect(r.lines.problems[0]).toContain("unitário 3,99 → 4,99");
    expect(r.names.ai.edited).toBe(1);
    expect(r.names.edits[0]).toContain(
      "Monster / Ultra → Energético / Monster / —",
    );
  });

  it("separa itens que vieram da memória", () => {
    const r = reportNote(
      note({ interpreted: [monster({ source: "memory" })] }),
    );
    expect(r.names.memory).toEqual({ total: 1, edited: 0 });
    expect(r.names.ai.total).toBe(0);
  });

  it("linha que a leitura pulou conta como errada", () => {
    const r = reportNote(
      note({ confirmed: [line(), line({ raw_description: "PAO FRANCES" })] }),
    );
    expect(r.lines).toMatchObject({ total: 2, correct: 1 });
    expect(r.lines.problems[0]).toContain("incluída");
  });

  it("rascunho não entra na conta de qualidade", () => {
    const r = reportNote(note({ confirmed: null }));
    expect(r.confirmed).toBe(false);
    expect(r.lines.total).toBe(0);
  });
});

describe("callsCost", () => {
  it("modelo sem preço conhecido deixa o custo em aberto", () => {
    expect(
      callsCost([
        { model: "outro", inputTokens: 1, outputTokens: 1, latencyMs: 1 },
      ]),
    ).toBeNull();
  });
});

describe("summarize", () => {
  it("soma as confirmadas e tira a média de custo de todas", () => {
    const s = summarize([
      reportNote(note()),
      reportNote(note({ id: 2, confirmed: null })),
    ]);
    expect(s).toMatchObject({
      receipts: 2,
      confirmed: 1,
      totalOk: { count: 1, of: 1 },
      lines: { correct: 1, of: 1 },
    });
    expect(s.avgCostUsd).toBeCloseTo(3);
  });
});

describe("loadReportNotes", () => {
  it("lê do banco só as notas com leitura guardada", async () => {
    const db = await testDb();
    try {
      const r = receipt();
      const call = {
        model: "claude-sonnet-5-5",
        promptVersion: "v",
        usage: { inputTokens: 100, outputTokens: 10 },
        latencyMs: 5,
      };
      const id = await saveDraft(db, {
        receipt: r,
        validation: validateReceipt(r),
        interpreted: [monster()],
        calls: {
          read: { ...call, payload: r },
          interpret: { ...call, payload: [monster()] },
        },
      });
      // importada sem leitura: fica de fora
      await saveDraft(db, {
        receipt: receipt({ access_key: null }),
        validation: validateReceipt(r),
        interpreted: [null],
        calls: { read: null, interpret: null },
      });
      const it = item();
      await confirmReceipt(db, id, [
        {
          ...monster(),
          raw_description: it.raw_description,
          ean: it.ean,
          store_code: null,
          quantity: 1,
          unit: "UN",
          unit_price_cents: 399,
          total_price_cents: 399,
          discount_cents: null,
          variant: "Zero",
        },
      ]);

      const notes = await loadReportNotes(db);
      expect(notes.map((n) => n.id)).toEqual([id]);
      expect(notes[0]?.calls).toHaveLength(2);
      const rep = reportNote(notes[0] as NoteInput);
      expect(rep.lines.correct).toBe(1);
      expect(rep.names.ai.edited).toBe(1);
    } finally {
      await db.close();
    }
  });
});

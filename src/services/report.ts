import { centsToInput, toCents } from "../lib/money.js";
import type { ReceiptRead } from "../schemas/receipt.js";
import type { InterpretedItem } from "./interpreter.js";
import { validateReceipt } from "./validators.js";

// Fase 8: mede a qualidade em uso comparando o que a IA devolveu (app.extractions)
// com o que o usuário confirmou na revisão (app.receipt_items). Funções puras; o
// carregamento do banco fica em db/report-repo.ts e a impressão em scripts/report.ts.

/** Critérios de saída da Fase 8 (plano, seção 4). */
export const TARGETS = {
  totalOk: 0.9, // notas com Σ itens = total na primeira foto
  linesOk: 0.97, // linhas com quantidade e preços corretos
  namesEdited: 0.1, // itens interpretados pela IA com nome/marca/variante corrigidos
} as const;

/** US$ por milhão de tokens (entrada, saída). Fonte: tabela de preços da Anthropic. */
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

export interface ConfirmedLine {
  raw_description: string | null;
  quantity: number | null;
  unit_price_cents: number | null;
  total_price_cents: number | null;
  product: string | null;
  brand: string | null;
  variant: string | null;
}

export interface CallUsage {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
}

export interface NoteInput {
  id: number;
  storeName: string | null;
  read: ReceiptRead;
  /** alinhado com read.items; null se a nota não passou pela interpretação */
  interpreted: (InterpretedItem | null)[] | null;
  /** itens confirmados; null enquanto a nota é rascunho */
  confirmed: ConfirmedLine[] | null;
  calls: CallUsage[];
}

export interface NoteReport {
  id: number;
  storeName: string | null;
  confirmed: boolean;
  totalCheck: "ok" | "fail" | "unknown";
  lines: { total: number; correct: number; problems: string[] };
  names: {
    ai: { total: number; edited: number };
    memory: { total: number; edited: number };
    edits: string[];
  };
  costUsd: number | null;
  latencyMs: number | null;
}

export function reportNote(note: NoteInput): NoteReport {
  const base = {
    id: note.id,
    storeName: note.storeName,
    totalCheck: validateReceipt(note.read).checks.total,
    costUsd: callsCost(note.calls),
    latencyMs: note.calls.every((c) => c.latencyMs !== null)
      ? note.calls.reduce((sum, c) => sum + (c.latencyMs ?? 0), 0)
      : null,
  };
  const lines = { total: 0, correct: 0, problems: [] as string[] };
  const names = {
    ai: { total: 0, edited: 0 },
    memory: { total: 0, edited: 0 },
    edits: [] as string[],
  };
  if (!note.confirmed) return { ...base, confirmed: false, lines, names };

  const readItems = note.read.items;
  const pairs = alignLines(
    readItems.map((i) => i.raw_description),
    note.confirmed.map((c) => c.raw_description),
  );

  for (const [r, c] of pairs) {
    lines.total++;
    const read = r === null ? null : readItems[r];
    const conf = c === null ? null : note.confirmed[c];
    const label = `"${conf?.raw_description ?? read?.raw_description ?? "?"}"`;
    if (!read) {
      lines.problems.push(`${label}: incluída na revisão (a leitura pulou)`);
      continue;
    }
    if (!conf) {
      lines.problems.push(`${label}: removida na revisão (a leitura inventou)`);
      continue;
    }

    const diffs: string[] = [];
    if (!sameQuantity(read.quantity, conf.quantity))
      diffs.push(`qtd ${read.quantity ?? "—"} → ${conf.quantity ?? "—"}`);
    if (cents(read.unit_price) !== conf.unit_price_cents)
      diffs.push(
        `unitário ${money(cents(read.unit_price))} → ${money(conf.unit_price_cents)}`,
      );
    if (cents(read.total_price) !== conf.total_price_cents)
      diffs.push(
        `total ${money(cents(read.total_price))} → ${money(conf.total_price_cents)}`,
      );
    if (diffs.length === 0) lines.correct++;
    else lines.problems.push(`${label}: ${diffs.join(", ")}`);

    const it = r === null ? null : (note.interpreted?.[r] ?? null);
    if (!it) continue;
    const bucket = it.source === "memory" ? names.memory : names.ai;
    bucket.total++;
    const changed = (["product", "brand", "variant"] as const).filter(
      (f) => (it[f] ?? "").trim() !== (conf[f] ?? "").trim(),
    );
    if (changed.length > 0) {
      bucket.edited++;
      names.edits.push(
        `${label} (${it.source === "memory" ? "memória" : "IA"}): ${describe(it)} → ${describe(conf)}`,
      );
    }
  }
  return { ...base, confirmed: true, lines, names };
}

export interface ReportSummary {
  receipts: number;
  confirmed: number;
  totalOk: { count: number; of: number };
  lines: { correct: number; of: number };
  namesAi: { edited: number; of: number };
  namesMemory: { edited: number; of: number };
  /** média só das notas com custo conhecido */
  avgCostUsd: number | null;
  avgLatencyMs: number | null;
}

export function summarize(notes: NoteReport[]): ReportSummary {
  const done = notes.filter((n) => n.confirmed);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const avg = (xs: (number | null)[]) => {
    const known = xs.filter((x): x is number => x !== null);
    return known.length > 0 ? sum(known) / known.length : null;
  };
  return {
    receipts: notes.length,
    confirmed: done.length,
    totalOk: {
      count: done.filter((n) => n.totalCheck === "ok").length,
      of: done.length,
    },
    lines: {
      correct: sum(done.map((n) => n.lines.correct)),
      of: sum(done.map((n) => n.lines.total)),
    },
    namesAi: {
      edited: sum(done.map((n) => n.names.ai.edited)),
      of: sum(done.map((n) => n.names.ai.total)),
    },
    namesMemory: {
      edited: sum(done.map((n) => n.names.memory.edited)),
      of: sum(done.map((n) => n.names.memory.total)),
    },
    avgCostUsd: avg(notes.map((n) => n.costUsd)),
    avgLatencyMs: avg(notes.map((n) => n.latencyMs)),
  };
}

/** Custo em US$ das chamadas; null se faltar token ou preço de algum modelo. */
export function callsCost(calls: CallUsage[]): number | null {
  let total = 0;
  for (const call of calls) {
    const price = PRICES_PER_MTOK[call.model];
    if (!price || call.inputTokens === null || call.outputTokens === null)
      return null;
    total +=
      (call.inputTokens * price.input + call.outputTokens * price.output) / 1e6;
  }
  return total;
}

/**
 * Casa as linhas lidas com as confirmadas, como um diff: primeiro as descrições
 * iguais em ordem (maior subsequência comum); nos trechos entre elas, pareia por
 * posição (o usuário corrigiu a descrição) e o que sobra foi incluído ou removido.
 * Devolve pares [índice lido, índice confirmado], com null do lado que falta.
 */
export function alignLines(
  read: (string | null)[],
  confirmed: (string | null)[],
): [number | null, number | null][] {
  const key = (s: string | null) =>
    (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  const a = read.map(key);
  const b = confirmed.map(key);

  // lcs(i, j) = tamanho da maior subsequência comum de a[i..] e b[j..]
  const width = b.length + 1;
  const table = new Int32Array((a.length + 1) * width);
  const lcs = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] !== "" && a[i] === b[j]
          ? lcs(i + 1, j + 1) + 1
          : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }

  const pairs: [number | null, number | null][] = [];
  let gapA: number[] = [];
  let gapB: number[] = [];
  const flushGap = () => {
    for (let k = 0; k < Math.max(gapA.length, gapB.length); k++)
      pairs.push([gapA[k] ?? null, gapB[k] ?? null]);
    gapA = [];
    gapB = [];
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] !== "" && a[i] === b[j]) {
      flushGap();
      pairs.push([i++, j++]);
    } else if (lcs(i + 1, j) >= lcs(i, j + 1)) {
      gapA.push(i++);
    } else {
      gapB.push(j++);
    }
  }
  while (i < a.length) gapA.push(i++);
  while (j < b.length) gapB.push(j++);
  flushGap();
  return pairs;
}

function cents(value: number | null): number | null {
  return value === null ? null : toCents(value);
}

function sameQuantity(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 1e-6;
}

function money(c: number | null): string {
  return c === null ? "—" : centsToInput(c);
}

function describe(i: {
  product: string | null;
  brand: string | null;
  variant: string | null;
}): string {
  return [i.product, i.brand, i.variant].map((x) => x ?? "—").join(" / ");
}

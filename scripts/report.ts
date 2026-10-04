// Uso: npm run report [-- --dolar 5.40]
// Fase 8: critérios de qualidade medidos nas notas enviadas pelo app (leitura da IA ×
// o que foi confirmado na revisão). Não chama a API; só lê o banco.
import { parseArgs } from "node:util";
import { connect } from "../src/db/connect.js";
import { loadReportNotes } from "../src/db/report-repo.js";
import {
  type NoteReport,
  reportNote,
  summarize,
  TARGETS,
} from "../src/services/report.js";

const { values } = parseArgs({ options: { dolar: { type: "string" } } });
const dolar = values.dolar ? Number(values.dolar.replace(",", ".")) : null;

const pct = (n: number, of: number) =>
  of === 0 ? "—" : `${((100 * n) / of).toFixed(1).replace(".", ",")}%`;
const usd = (v: number) => {
  const brl = dolar ? ` (R$ ${(v * dolar).toFixed(2).replace(".", ",")})` : "";
  return `US$ ${v.toFixed(3).replace(".", ",")}${brl}`;
};
const secs = (ms: number) => `${Math.round(ms / 1000)} s`;
const mark = (ok: boolean | null) => (ok === null ? " " : ok ? "✓" : "✗");

function row(
  label: string,
  n: number,
  of: number,
  target: string,
  ok: boolean,
) {
  const value = `${n}/${of}`.padStart(9) + pct(n, of).padStart(9);
  return `${label.padEnd(38)}${value}   ${target.padEnd(7)} ${mark(of === 0 ? null : ok)}`;
}

function noteLine(n: NoteReport): string {
  const head = `#${n.id} ${n.storeName ?? "loja?"}`;
  const cost = [
    n.costUsd === null ? "custo ?" : usd(n.costUsd),
    n.latencyMs === null ? null : secs(n.latencyMs),
  ]
    .filter(Boolean)
    .join(" · ");
  if (!n.confirmed) return `${head} — rascunho · ${cost}`;
  const total = { ok: "total ok", fail: "total NÃO fecha", unknown: "total ?" };
  return `${head} — ${total[n.totalCheck]} · linhas ${n.lines.correct}/${n.lines.total} · nomes IA ${n.names.ai.edited}/${n.names.ai.total} corrigidos · ${cost}`;
}

const db = connect();
try {
  const notes = (await loadReportNotes(db)).map(reportNote);
  const s = summarize(notes);

  console.log(
    `Fase 8 — ${s.receipts} notas lidas pelo app: ${s.confirmed} confirmadas, ${s.receipts - s.confirmed} rascunhos\n`,
  );
  console.log(
    row(
      "Σ itens = total na 1ª foto",
      s.totalOk.count,
      s.totalOk.of,
      "≥ 90%",
      s.totalOk.count >= TARGETS.totalOk * s.totalOk.of,
    ),
  );
  console.log(
    row(
      "Linhas com qtd e preços corretos",
      s.lines.correct,
      s.lines.of,
      "≥ 97%",
      s.lines.correct >= TARGETS.linesOk * s.lines.of,
    ),
  );
  console.log(
    row(
      "Itens da IA com nome corrigido",
      s.namesAi.edited,
      s.namesAi.of,
      "≤ 10%",
      s.namesAi.edited <= TARGETS.namesEdited * s.namesAi.of,
    ),
  );
  console.log(
    row(
      "Itens da memória com nome corrigido",
      s.namesMemory.edited,
      s.namesMemory.of,
      "(info)",
      true,
    ),
  );
  console.log(
    `${"Custo médio por nota".padEnd(38)}${s.avgCostUsd === null ? "—" : usd(s.avgCostUsd)}`,
  );
  console.log(
    `${"Tempo médio de processamento".padEnd(38)}${s.avgLatencyMs === null ? "—" : secs(s.avgLatencyMs)}`,
  );
  if (s.confirmed < 20)
    console.log(
      `\nAmostra pequena: ${s.confirmed} confirmadas (o plano pede 20–30 antes de concluir).`,
    );

  console.log("\nPor nota:");
  for (const n of notes) {
    console.log(noteLine(n));
    for (const p of [...n.lines.problems, ...n.names.edits])
      console.log(`    - ${p}`);
  }
} finally {
  await db.close();
}

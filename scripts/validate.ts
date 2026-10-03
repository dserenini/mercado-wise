// Uso: npm run validate -- leitura1.json [leitura2.json ...]
// Confere leituras já salvas (saída do `npm run read`) sem chamar a API.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { formatCents, toCents } from "../src/lib/money.js";
import { ReceiptReadSchema } from "../src/schemas/receipt.js";
import {
  type TrafficLight,
  validateReceipt,
} from "../src/services/validators.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Uso: npm run validate -- leitura1.json [leitura2.json ...]");
  process.exit(1);
}

const LIGHT: Record<TrafficLight, string> = {
  green: "🟢 verde",
  yellow: "🟡 amarelo",
  red: "🔴 vermelho",
};

const tally: Record<TrafficLight, number> = { green: 0, yellow: 0, red: 0 };

for (const file of files) {
  const receipt = ReceiptReadSchema.parse(
    JSON.parse(await readFile(file, "utf8")),
  );
  const v = validateReceipt(receipt);
  tally[v.trafficLight]++;

  const itemsWithErrors = v.items.filter((i) =>
    i.problems.some((p) => p.severity === "error"),
  );
  console.log(
    `${LIGHT[v.trafficLight].padEnd(11)} ${basename(file).padEnd(24)} ` +
      `${String(receipt.items.length).padStart(3)} itens  ` +
      `soma ${formatCents(v.expectedTotalCents).padStart(11)}  ` +
      `nota ${receipt.total === null ? "?".padStart(11) : formatCents(toCents(receipt.total)).padStart(11)}  ` +
      `itens c/ erro: ${itemsWithErrors.length}`,
  );

  for (const p of v.problems)
    console.log(`    ${p.severity === "error" ? "✗" : "!"} ${p.message}`);
  for (const i of v.items) {
    for (const p of i.problems) {
      const desc = receipt.items[i.index]?.raw_description ?? "?";
      console.log(
        `    ${p.severity === "error" ? "✗" : "!"} item ${i.index + 1} (${desc}): ${p.message}`,
      );
    }
  }
}

console.log(
  `\n${files.length} notas: ${tally.green} verdes, ${tally.yellow} amarelas, ${tally.red} vermelhas`,
);

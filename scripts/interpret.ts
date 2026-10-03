// Uso: npm run interpret -- leitura1.read.json [leitura2.read.json ...]
// Interpreta leituras já salvas, sem reler a foto. Para cada "X.read.json" grava
// "X.interpret.json" ao lado e imprime a tabela crua × interpretada.
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { ReceiptReadSchema } from "../src/schemas/receipt.js";
import { interpretItems } from "../src/services/interpreter.js";
import { formatItems } from "./lib/print.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(
    "Uso: npm run interpret -- leitura1.read.json [leitura2.read.json ...]",
  );
  process.exit(1);
}

let inputTokens = 0;
let outputTokens = 0;
for (const file of files) {
  const receipt = ReceiptReadSchema.parse(
    JSON.parse(await readFile(file, "utf8")),
  );
  const result = await interpretItems(receipt.items, receipt.store);

  const out = `${file.replace(/\.read\.json$/, "")}.interpret.json`;
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);

  console.log(`\n== ${basename(file)} — ${receipt.store.name ?? "?"}`);
  console.log(formatItems(receipt.items, result.items));
  if (result.call) {
    inputTokens += result.call.usage.inputTokens;
    outputTokens += result.call.usage.outputTokens;
    console.log(
      `${result.call.model} (${result.call.promptVersion}): ` +
        `${result.call.usage.inputTokens}/${result.call.usage.outputTokens} tokens, ` +
        `${(result.call.latencyMs / 1000).toFixed(1)} s`,
    );
  }
}
console.log(
  `\nTotal: ${inputTokens} tokens de entrada, ${outputTokens} de saída`,
);

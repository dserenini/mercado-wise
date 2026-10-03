// Uso: npm run process -- caminho/da/foto.jpg
// Roda o pipeline completo (ler → validar → interpretar) e imprime o resultado.
// O JSON completo vai para o stdout; a tabela e o resumo, para o stderr.
import { readFile } from "node:fs/promises";
import { processReceiptPhoto } from "../src/services/pipeline.js";
import { formatItems } from "./lib/print.js";

const path = process.argv[2];
if (!path) {
  console.error("Uso: npm run process -- caminho/da/foto.jpg");
  process.exit(1);
}

const result = await processReceiptPhoto(await readFile(path));
console.log(JSON.stringify(result, null, 2));

const { read, validation, interpretation } = result;
console.error(formatItems(read.receipt.items, interpretation.items));
console.error(
  [
    `\nSemáforo: ${validation.trafficLight}`,
    ...validation.problems.map((p) => `  ${p.message}`),
    ...validation.items.flatMap((i) =>
      i.problems.map((p) => `  item ${i.index + 1}: ${p.message}`),
    ),
    `Leitura: ${read.usage.inputTokens}/${read.usage.outputTokens} tokens, ${(read.latencyMs / 1000).toFixed(1)} s`,
    interpretation.call
      ? `Interpretação: ${interpretation.call.usage.inputTokens}/${interpretation.call.usage.outputTokens} tokens, ${(interpretation.call.latencyMs / 1000).toFixed(1)} s`
      : "Interpretação: tudo veio da memória",
  ].join("\n"),
);

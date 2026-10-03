// Uso: npm run read -- caminho/da/foto.jpg
// Lê a foto com o Claude e imprime o ReceiptRead (JSON) no stdout.
// O resumo (modelo, tokens, tempo) vai para o stderr, então dá para salvar só o JSON:
//   npm run read -- foto.jpg > leitura.json
import { readFile } from "node:fs/promises";
import { prepareImage } from "../src/services/image.js";
import { readReceipt } from "../src/services/reader.js";

const path = process.argv[2];
if (!path) {
  console.error("Uso: npm run read -- caminho/da/foto.jpg");
  process.exit(1);
}

const image = await prepareImage(await readFile(path));
console.error(
  `Imagem: ${image.width}x${image.height} px, ${Math.round(image.data.length / 1024)} KB`,
);

const result = await readReceipt(image);
console.log(JSON.stringify(result.receipt, null, 2));

const { receipt, usage } = result;
console.error(
  [
    `Modelo: ${result.model} (${result.promptVersion})`,
    `Itens lidos: ${receipt.items.length}${receipt.items_count === null ? "" : ` (nota diz ${receipt.items_count})`}`,
    `Total impresso: ${receipt.total ?? "?"}`,
    `Tokens: ${usage.inputTokens} entrada / ${usage.outputTokens} saída`,
    `Tempo: ${(result.latencyMs / 1000).toFixed(1)} s`,
  ].join("\n"),
);

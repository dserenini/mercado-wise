// Uso: npm run import-saved -- [pasta]   (padrão: eval/out/originals)
// Grava como rascunho as notas já lidas e interpretadas (arquivos "nota (N).read.json"
// e "nota (N).interpret.json"), sem chamar a API. Nota repetida é ignorada.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { connect } from "../src/db/connect.js";
import { findReceiptByAccessKey, saveDraft } from "../src/db/receipts-repo.js";
import { ReceiptReadSchema } from "../src/schemas/receipt.js";
import type { InterpretResult } from "../src/services/interpreter.js";
import { validateReceipt } from "../src/services/validators.js";

const dir = process.argv[2] ?? "eval/out/originals";
const reads = (await readdir(dir))
  .filter((f) => f.endsWith(".read.json"))
  .sort();

const db = connect();
try {
  for (const file of reads) {
    const receipt = ReceiptReadSchema.parse(
      JSON.parse(await readFile(join(dir, file), "utf8")),
    );
    if (
      receipt.access_key &&
      (await findReceiptByAccessKey(db, receipt.access_key))
    ) {
      console.log(`${file}: já cadastrada, ignorada`);
      continue;
    }
    const interpretFile = join(
      dir,
      file.replace(/\.read\.json$/, ".interpret.json"),
    );
    const interpretation: InterpretResult = JSON.parse(
      await readFile(interpretFile, "utf8").catch(
        () => '{"items":[],"call":null}',
      ),
    );
    const id = await saveDraft(db, {
      receipt,
      validation: validateReceipt(receipt),
      interpreted: interpretation.items,
      calls: {
        read: null, // os .read.json não guardaram modelo e tokens
        interpret: interpretation.call && {
          ...interpretation.call,
          payload: interpretation.items,
        },
      },
    });
    console.log(`${file}: rascunho #${id} (${receipt.items.length} itens)`);
  }
} finally {
  await db.close();
}

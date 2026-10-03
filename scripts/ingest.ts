// Uso: npm run ingest -- caminho/da/foto.jpg
// Pipeline completo (usa a API) com a memória do banco, e grava a nota como rascunho.
import { readFile } from "node:fs/promises";
import { connect } from "../src/db/connect.js";
import { createDbMemory } from "../src/db/memory.js";
import {
  draftFromPipeline,
  findReceiptByAccessKey,
  saveDraft,
} from "../src/db/receipts-repo.js";
import { processReceiptPhoto } from "../src/services/pipeline.js";
import { formatItems } from "./lib/print.js";

const path = process.argv[2];
if (!path) {
  console.error("Uso: npm run ingest -- caminho/da/foto.jpg");
  process.exit(1);
}

const db = connect();
try {
  const result = await processReceiptPhoto(await readFile(path), {
    memory: createDbMemory(db),
  });
  const { receipt } = result.read;
  console.log(formatItems(receipt.items, result.interpretation.items));

  const duplicate = receipt.access_key
    ? await findReceiptByAccessKey(db, receipt.access_key)
    : null;
  if (duplicate) {
    console.log(
      `\nNota já cadastrada (#${duplicate.id}, ${duplicate.status}). Nada gravado.`,
    );
  } else {
    // A foto em si passa a ser guardada na fase 6 (Supabase Storage).
    const id = await saveDraft(db, draftFromPipeline(result, null));
    const fromMemory = result.interpretation.items.filter(
      (i) => i?.source === "memory",
    ).length;
    console.log(
      `\nRascunho #${id} gravado — semáforo ${result.validation.trafficLight}, ` +
        `${fromMemory}/${receipt.items.length} itens vieram da memória.`,
    );
  }
} finally {
  await db.close();
}

// Uso: npm run ingest -- caminho/da/foto.jpg
// Pipeline completo (usa a API) com a memória do banco; grava a nota como rascunho.
import { readFile } from "node:fs/promises";
import { connect } from "../src/db/connect.js";
import { getReceipt } from "../src/db/receipts-repo.js";
import { ingestPhoto } from "../src/services/ingest.js";

const path = process.argv[2];
if (!path) {
  console.error("Uso: npm run ingest -- caminho/da/foto.jpg");
  process.exit(1);
}

const db = connect();
try {
  const result = await ingestPhoto(db, await readFile(path));
  if (result.kind === "duplicate") {
    console.log(
      `Nota já cadastrada (#${result.id}, ${result.status}). Nada gravado.`,
    );
  } else {
    const saved = await getReceipt(db, result.id);
    const items = saved?.items ?? [];
    const fromMemory = items.filter(
      (i) => i.interpretation_source === "memory",
    ).length;
    console.log(
      `Rascunho #${result.id} gravado — semáforo ${saved?.receipt.traffic_light}, ` +
        `${items.length} itens, ${fromMemory} vieram da memória.`,
    );
  }
} finally {
  await db.close();
}

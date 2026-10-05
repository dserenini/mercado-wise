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
  if (result.kind === "same-photo") {
    console.log(
      `Foto já cadastrada (#${result.id}, ${result.status}). Nada gravado.`,
    );
  } else {
    const saved = await getReceipt(db, result.id);
    const r = saved?.receipt;
    const items = saved?.items ?? [];
    const fromMemory = items.filter(
      (i) => i.interpretation_source === "memory",
    ).length;
    if (r?.status === "failed") console.log(`#${result.id} falhou: ${r.error}`);
    else if (r?.status === "duplicate")
      console.log(
        `#${result.id} parece repetir a #${r.duplicate_of} (${r.duplicate_reason}).`,
      );
    else
      console.log(
        `Rascunho #${result.id} gravado — semáforo ${r?.traffic_light}, ` +
          `${items.length} itens, ${fromMemory} vieram da memória.`,
      );
  }
} finally {
  await db.close();
}

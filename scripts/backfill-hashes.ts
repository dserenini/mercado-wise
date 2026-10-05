// Uso: npm run backfill-hashes
// Calcula a impressão digital (dHash) das fotos gravadas antes de ela existir, para a
// foto repetida ser recusada também contra as notas antigas. Não chama a API.
import { connect } from "../src/db/connect.js";
import { imageHash } from "../src/services/image.js";

const db = connect();
try {
  const rows = await db.query<{ receipt_id: number; data: Uint8Array }>(
    "select receipt_id, data from app.receipt_images where hash is null",
  );
  for (const row of rows) {
    const hash = await imageHash(Buffer.from(row.data));
    await db.query(
      "update app.receipt_images set hash = $2 where receipt_id = $1",
      [row.receipt_id, hash],
    );
  }
  console.log(`Impressões digitais calculadas: ${rows.length}`);
} finally {
  await db.close();
}

// Uso: npm run enrich-stores
// Completa os campos vazios das lojas ainda não consultadas (CNPJ na BrasilAPI e
// coordenadas no OpenStreetMap). Nunca sobrescreve o que foi editado. Uma loja por
// vez, com pausa: o OpenStreetMap aceita no máximo uma consulta por segundo.
// Para produção: node --env-file=.env.production --import tsx scripts/enrich-stores.ts
import { setTimeout as sleep } from "node:timers/promises";
import { connect } from "../src/db/connect.js";
import { getStore, storesToEnrich } from "../src/db/stores-repo.js";
import { enrichStore } from "../src/services/stores.js";

const db = connect();
try {
  const stores = await storesToEnrich(db);
  console.log(`${stores.length} loja(s) a consultar.`);
  for (const store of stores) {
    const ok = await enrichStore(db, store);
    const after = await getStore(db, store.cnpj);
    console.log(
      ok
        ? `✓ ${store.cnpj} ${after?.name}: ${[after?.city, after?.state].filter(Boolean).join(" - ") || "sem cidade"}${after?.latitude == null ? ", sem coordenadas" : ""}`
        : `✗ ${store.cnpj} ${store.name}: sem resposta (fica para a próxima)`,
    );
    await sleep(1_100);
  }
} finally {
  await db.close();
}

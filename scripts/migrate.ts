// Uso: npm run migrate
// Aplica no banco (Supabase) as migrations de migrations/ que ainda não rodaram.
import { connect } from "../src/db/connect.js";
import { migrate } from "../src/db/migrate.js";

const db = connect();
try {
  const applied = await migrate(db);
  console.log(
    applied.length > 0
      ? `Aplicadas: ${applied.join(", ")}`
      : "Nada a aplicar: banco em dia.",
  );
} finally {
  await db.close();
}

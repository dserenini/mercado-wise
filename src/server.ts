import { createApp } from "./app.js";
import { config } from "./config.js";
import { connect } from "./db/connect.js";
import { ingestPhoto } from "./services/ingest.js";

if (!config.APP_PASSWORD_HASH || !config.SESSION_SECRET) {
  console.error(
    "Faltam APP_PASSWORD_HASH e SESSION_SECRET no .env. Rode `npm run setup-login` e cole as duas linhas.",
  );
  process.exit(1);
}

const db = connect();
const app = createApp({
  db,
  ingest: (photo) => ingestPhoto(db, photo),
  passwordHash: config.APP_PASSWORD_HASH,
  sessionSecret: config.SESSION_SECRET,
  secure: process.env.NODE_ENV === "production",
});

// 0.0.0.0: aceita conexões da rede local (abrir no celular pelo IP do PC).
app.listen(config.PORT, "0.0.0.0", () => {
  console.log(`mercado-wise ouvindo em http://localhost:${config.PORT}`);
});

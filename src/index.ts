import express from "express";
import { config } from "./config.js";
import { createApp } from "./create-app.js";
import { connect } from "./db/connect.js";
import { ingestPhoto } from "./services/ingest.js";

// Ponto de entrada do app: a Vercel procura src/index.ts, exige que ele importe o
// express e usa o export default. Localmente, src/server.ts importa este arquivo e
// abre a porta.

if (!config.APP_PASSWORD_HASH || !config.SESSION_SECRET) {
  throw new Error(
    "Faltam APP_PASSWORD_HASH e SESSION_SECRET: rode `npm run setup-login` e configure as duas variáveis.",
  );
}

const db = connect();
// Na Vercel (HTTPS atrás de proxy): cookie só por HTTPS e IP real do cliente.
const secure =
  process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

const app = express();
if (secure) app.set("trust proxy", 1);
app.use(
  createApp({
    db,
    ingest: (photo) => ingestPhoto(db, photo),
    passwordHash: config.APP_PASSWORD_HASH,
    sessionSecret: config.SESSION_SECRET,
    secure,
  }),
);

export default app;

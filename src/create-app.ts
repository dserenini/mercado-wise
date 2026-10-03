import { join } from "node:path";
import cookieSession from "cookie-session";
import express, { type ErrorRequestHandler } from "express";
import type { Db } from "./db/client.js";
import { centsToInput, decimalToInput, formatCents } from "./lib/money.js";
import { authRoutes, requireLogin } from "./routes/auth.js";
import { receiptRoutes } from "./routes/receipts.js";
import { CATEGORIES } from "./schemas/interpretation.js";
import type { IngestResult } from "./services/ingest.js";

export interface AppDeps {
  db: Db;
  /** foto → rascunho no banco (nos testes, uma versão falsa que não chama a IA) */
  ingest: (photo: Buffer) => Promise<IngestResult>;
  passwordHash: string;
  sessionSecret: string;
  /** atrás de HTTPS (produção): cookie só via HTTPS e IP real vindo do proxy */
  secure?: boolean;
}

// Monta o app sem abrir porta: src/index.ts o configura (Vercel), e os testes
// usam o app direto (supertest), sem precisar subir servidor.
export function createApp(deps: AppDeps) {
  const app = express();
  const here = import.meta.dirname;

  app.set("view engine", "ejs");
  app.set("views", join(here, "views"));
  if (deps.secure) app.set("trust proxy", 1);

  // Funções e listas disponíveis em todas as telas.
  app.locals.formatCents = formatCents;
  app.locals.centsToInput = centsToInput;
  app.locals.decimalToInput = decimalToInput;
  app.locals.CATEGORIES = CATEGORIES;
  // Muda a cada reinício: o navegador baixa CSS/JS novos depois de um deploy.
  app.locals.assetVersion = Date.now().toString(36);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Arquivos de public/ (CSS, JS, Pico). Na Vercel quem serve é a CDN e esta linha
  // é ignorada; localmente, o próprio Express serve.
  app.use(express.static(join(here, "..", "public"), { maxAge: 0 }));

  // extended: itens chegam como items[0][campo]; o limite cobre notas compridas.
  app.use(express.urlencoded({ extended: true, parameterLimit: 10_000 }));
  app.use(
    cookieSession({
      name: "mw",
      keys: [deps.sessionSecret],
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      // lax: o navegador não manda o cookie em POST vindo de outro site (CSRF).
      sameSite: "lax",
      secure: deps.secure ?? false,
    }),
  );

  app.use(authRoutes(deps.passwordHash));
  app.use(requireLogin);
  app.use(receiptRoutes(deps));

  app.use((_req, res) => {
    res.status(404).render("message", {
      title: "Não encontrado",
      message: "Página não existe.",
    });
  });

  // Erro inesperado: registra no log e mostra uma página simples (sem stack trace).
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error(error);
    res.status(500).render("message", {
      title: "Algo deu errado",
      message:
        "Tente de novo em instantes. Se continuar, veja os logs do servidor.",
    });
  };
  app.use(onError);

  return app;
}

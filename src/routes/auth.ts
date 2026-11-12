import { type RequestHandler, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { verifyPassword } from "../auth/password.js";
import type { Db } from "../db/client.js";
import { findUser } from "../db/users-repo.js";

// Usuário e senha (app.users). A sessão fica num cookie assinado (cookie-session) e
// guarda quem entrou. `legacyHash` é a senha única de antes (APP_PASSWORD_HASH): vale
// para quem não tem senha própria no banco (o danilo, primeiro usuário).

export function authRoutes(db: Db, legacyHash: string): Router {
  const router = Router();

  // Cada tentativa errada custa pouco para um robô; o limite torna adivinhar inviável.
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).render("login", {
        error: "Muitas tentativas. Espere 15 minutos e tente de novo.",
        username: "",
      });
    },
  });

  router.get("/login", (_req, res) => {
    res.render("login", { error: null, username: "" });
  });

  router.post("/login", loginLimit, async (req, res) => {
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    const username = text(req.body?.username).trim().toLowerCase();
    const password = text(req.body?.password);
    const user = await findUser(db, username);
    // Usuário inexistente também calcula um hash: o tempo de resposta não revela
    // quais nomes existem.
    const ok = await verifyPassword(
      password,
      user?.password_hash ?? legacyHash,
    );
    if (!user || !ok) {
      res.status(401).render("login", {
        error: "Usuário ou senha incorretos.",
        username,
      });
      return;
    }
    req.session = { userId: user.id, username: user.username };
    res.redirect(303, "/");
  });

  router.post("/logout", (req, res) => {
    req.session = null;
    res.redirect(303, "/login");
  });

  return router;
}

/** Quem está logado; as rotas atrás do requireLogin sempre têm um. */
export interface CurrentUser {
  id: number;
  username: string;
}

export function currentUser(session: unknown): CurrentUser | null {
  const s = session as { userId?: unknown; username?: unknown } | null;
  return typeof s?.userId === "number" && typeof s.username === "string"
    ? { id: s.userId, username: s.username }
    : null;
}

// Sessão antiga (de antes dos usuários, só { loggedIn }) não tem userId: pede login.
export const requireLogin: RequestHandler = (req, res, next) => {
  const user = currentUser(req.session);
  if (user) {
    res.locals.currentUser = user;
    // aba ativa na navegação (partials/top.ejs)
    res.locals.path = req.path;
    next();
    return;
  }
  res.redirect(303, "/login");
};

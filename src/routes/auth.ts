import { type RequestHandler, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { verifyPassword } from "../auth/password.js";

// Um usuário só, uma senha só. A sessão fica num cookie assinado (cookie-session).

export function authRoutes(passwordHash: string): Router {
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
      });
    },
  });

  router.get("/login", (_req, res) => {
    res.render("login", { error: null });
  });

  router.post("/login", loginLimit, async (req, res) => {
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    if (!(await verifyPassword(password, passwordHash))) {
      res.status(401).render("login", { error: "Senha incorreta." });
      return;
    }
    req.session = { loggedIn: true };
    res.redirect(303, "/");
  });

  router.post("/logout", (req, res) => {
    req.session = null;
    res.redirect(303, "/login");
  });

  return router;
}

export const requireLogin: RequestHandler = (req, res, next) => {
  if (req.session?.loggedIn) {
    next();
    return;
  }
  res.redirect(303, "/login");
};

import express from "express";

// Monta o app sem abrir porta: o server.ts chama listen(), e os testes
// usam o app direto (supertest), sem precisar subir servidor.
export function createApp() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}

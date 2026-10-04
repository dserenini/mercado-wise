import { Router } from "express";
import type { AppDeps } from "../create-app.js";
import { createDbMemory } from "../db/memory.js";
import { suggestItems } from "../db/suggest-repo.js";

// Autocompletar da revisão (JSON, atrás do login). Não chama a IA.

const text = (value: unknown) => (typeof value === "string" ? value : "");
const digits = (value: unknown) => {
  const d = text(value).replace(/\D/g, "");
  return d === "" ? null : d;
};

export function suggestRoutes({ db }: AppDeps): Router {
  const router = Router();
  const memory = createDbMemory(db);

  // ?q=texto&cnpj=… → itens já confirmados que combinam com o texto
  router.get("/suggest/items", async (req, res) => {
    res.json(
      await suggestItems(
        db,
        text(req.query.q).slice(0, 80),
        digits(req.query.cnpj),
      ),
    );
  });

  // ?ean=…&store_code=…&cnpj=… → o que a memória lembra desse código (ou null)
  router.get("/suggest/code", async (req, res) => {
    const ean = digits(req.query.ean);
    const storeCode = text(req.query.store_code).trim() || null;
    if (!ean && !storeCode) {
      res.json(null);
      return;
    }
    const found = await memory.find(
      {
        raw_description: null,
        ean,
        store_code: storeCode,
        quantity: null,
        unit: null,
        unit_price: null,
        total_price: null,
        discount: null,
      },
      { name: null, cnpj: digits(req.query.cnpj) },
    );
    res.json(found);
  });

  return router;
}

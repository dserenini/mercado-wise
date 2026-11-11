import { Router } from "express";
import type { AppDeps } from "../create-app.js";
import {
  getProduct,
  productPrices,
  searchProducts,
} from "../db/prices-repo.js";
import { priceChart } from "../services/price-chart.js";
import type { CurrentUser } from "./auth.js";

// Produtos: busca e, para cada um, o preço ao longo do tempo nas notas confirmadas
// de todos os usuários.

export function productRoutes({ db }: AppDeps): Router {
  const router = Router();

  router.get("/products", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 80) : "";
    res.render("products", { q, products: await searchProducts(db, q) });
  });

  router.get("/products/:id", async (req, res) => {
    const id = Number(req.params.id);
    const product =
      Number.isInteger(id) && id > 0 ? await getProduct(db, id) : null;
    if (!product) {
      res
        .status(404)
        .render("message", { title: "Produto não encontrado", message: "" });
      return;
    }
    const me: CurrentUser = res.locals.currentUser;
    const prices = await productPrices(db, id);
    res.render("product", {
      product,
      prices,
      chart: priceChart(prices, me.id),
    });
  });

  return router;
}

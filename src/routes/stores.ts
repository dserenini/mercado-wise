import { type Response, Router } from "express";
import type { AppDeps } from "../create-app.js";
import {
  getStore,
  listStores,
  type StoreFields,
  storeReceipts,
  updateStore,
} from "../db/stores-repo.js";
import { isMissingTable } from "../services/ai-settings.js";
import { enrichStore } from "../services/stores.js";

// Mercados: lista, página de cada um (dados editáveis + números calculados + notas)
// e o botão que completa os campos vazios pelo CNPJ e pelo endereço.

const CNPJ = /^\d{14}$/;

/** Formulário → campos da loja, ou a lista de problemas. */
export function parseStoreForm(
  body: Record<string, unknown>,
): { fields: StoreFields } | { errors: string[] } {
  const errors: string[] = [];
  const text = (key: string, max: number) => {
    const v = typeof body[key] === "string" ? body[key].trim() : "";
    if (v.length > max) errors.push(`"${key}" passa de ${max} caracteres.`);
    return v === "" ? null : v;
  };
  const coord = (key: string, limit: number, label: string) => {
    const v = typeof body[key] === "string" ? body[key].trim() : "";
    if (v === "") return null;
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n) || Math.abs(n) > limit) {
      errors.push(`${label} inválida (entre -${limit} e ${limit}).`);
      return null;
    }
    return n;
  };
  const name = text("name", 150);
  if (!name) errors.push("O nome é obrigatório.");
  const cep = (text("postal_code", 12) ?? "").replace(/\D/g, "");
  if (cep !== "" && cep.length !== 8) errors.push("O CEP tem 8 dígitos.");
  const fields: StoreFields = {
    name: name ?? "",
    legal_name: text("legal_name", 200),
    address: text("address", 300),
    district: text("district", 100),
    postal_code: cep === "" ? null : cep,
    city: text("city", 100),
    state: text("state", 40),
    country: text("country", 60) ?? "BR",
    latitude: coord("latitude", 90, "Latitude"),
    longitude: coord("longitude", 180, "Longitude"),
  };
  return errors.length > 0 ? { errors } : { fields };
}

export function storeRoutes({ db, storeLookup: lookup }: AppDeps): Router {
  const router = Router();

  // Banco sem a migration 009: avisa em vez de dar erro 500.
  const unavailable = (res: Response, error: unknown) => {
    if (!isMissingTable(error)) throw error;
    res.status(503).render("message", {
      title: "Mercados indisponíveis",
      message:
        "O banco ainda não tem a tabela de mercados: rode `npm run migrate`.",
    });
  };

  router.get("/stores", async (_req, res) => {
    try {
      res.render("stores", { stores: await listStores(db) });
    } catch (error) {
      unavailable(res, error);
    }
  });

  async function renderStore(
    res: Response,
    cnpj: string,
    extra: { errors?: string[]; flash?: string | null; form?: unknown } = {},
  ) {
    const store = await getStore(db, cnpj);
    if (!store) {
      res
        .status(404)
        .render("message", { title: "Mercado não encontrado", message: "" });
      return;
    }
    res.status(extra.errors?.length ? 400 : 200).render("store", {
      store,
      form: extra.form ?? store,
      receipts: await storeReceipts(db, cnpj),
      errors: extra.errors ?? [],
      flash: extra.flash ?? null,
      canEnrich: lookup !== undefined,
    });
  }

  router.get("/stores/:cnpj", async (req, res) => {
    const cnpj = req.params.cnpj;
    if (!CNPJ.test(cnpj)) {
      res
        .status(404)
        .render("message", { title: "Mercado não encontrado", message: "" });
      return;
    }
    const flash =
      req.query.salvo === "1"
        ? "Dados salvos."
        : req.query.completado === "1"
          ? "Campos vazios completados pelo CNPJ e pelo endereço."
          : req.query.completado === "0"
            ? "Não deu para consultar agora (sem resposta do serviço). Tente de novo mais tarde."
            : null;
    try {
      await renderStore(res, cnpj, { flash });
    } catch (error) {
      unavailable(res, error);
    }
  });

  router.post("/stores/:cnpj", async (req, res) => {
    const cnpj = req.params.cnpj;
    const parsed = parseStoreForm(req.body ?? {});
    try {
      if ("errors" in parsed) {
        await renderStore(res, cnpj, {
          errors: parsed.errors,
          form: req.body,
        });
        return;
      }
      if (!CNPJ.test(cnpj) || !(await updateStore(db, cnpj, parsed.fields))) {
        res
          .status(404)
          .render("message", { title: "Mercado não encontrado", message: "" });
        return;
      }
      res.redirect(303, `/stores/${cnpj}?salvo=1`);
    } catch (error) {
      unavailable(res, error);
    }
  });

  // Completa só os campos vazios (nunca sobrescreve o que foi editado).
  router.post("/stores/:cnpj/enrich", async (req, res) => {
    const cnpj = req.params.cnpj;
    try {
      const store = CNPJ.test(cnpj) ? await getStore(db, cnpj) : null;
      if (!store || !lookup) {
        res
          .status(404)
          .render("message", { title: "Mercado não encontrado", message: "" });
        return;
      }
      const ok = await enrichStore(db, store, lookup);
      res.redirect(303, `/stores/${cnpj}?completado=${ok ? "1" : "0"}`);
    } catch (error) {
      unavailable(res, error);
    }
  });

  return router;
}

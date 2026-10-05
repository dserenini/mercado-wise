import { type Request, Router } from "express";
import multer from "multer";
import type { AppDeps } from "../create-app.js";
import {
  confirmReceipt,
  deleteReceipt,
  getReceipt,
  getReceiptImage,
  listBounds,
  listReceipts,
} from "../db/receipts-repo.js";
import { storeNames } from "../db/suggest-repo.js";
import { ReadError } from "../services/reader.js";
import { withLineMath, withMemory } from "../services/review.js";
import { filterQuery, groupByMonth, parseListFilter } from "./list-filter.js";
import { parseReviewForm } from "./review-form.js";

// Rotas só recebem, chamam serviços/repositório e escolhem a tela. Nada de SQL ou
// chamada à IA aqui.

const upload = multer({
  storage: multer.memoryStorage(),
  // O navegador já reduz a foto (~300 KB); o limite cobre o caso sem JavaScript.
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

export function receiptRoutes({ db, ingest }: AppDeps): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const { filter, form, active } = parseListFilter(req.query);
    // Lembra os filtros para voltar a eles depois de abrir/confirmar uma nota.
    if (req.session) req.session.listQuery = filterQuery(form);
    const receipts = await listReceipts(db, filter);
    res.render("list", {
      receipts,
      groups: groupByMonth(receipts, filter.order),
      form,
      active,
      bounds: await listBounds(db),
      totalCents: receipts.reduce((acc, r) => acc + (r.total_cents ?? 0), 0),
      flash: await flashFor(req.query),
    });
  });

  // Aviso depois de confirmar (?confirmada=ID) ou salvar correções (?corrigida=ID).
  async function flashFor(query: Record<string, unknown>) {
    const kind = query.confirmada ? "confirmada" : "corrigida";
    const id = Number(query[kind]);
    if (!Number.isInteger(id) || id <= 0) return null;
    const saved = await getReceipt(db, id);
    return saved ? { kind, receipt: saved.receipt } : null;
  }

  const listUrl = (req: Request) => {
    const query: unknown = req.session?.listQuery;
    return typeof query === "string" && query !== "" ? `/?${query}` : "/";
  };

  router.get("/receipts/new", (_req, res) => {
    res.render("upload", { error: null });
  });

  router.post("/receipts", upload.single("photo"), async (req, res) => {
    if (!req.file) {
      res
        .status(400)
        .render("upload", { error: "Envie a foto da nota (imagem)." });
      return;
    }
    try {
      const result = await ingest(req.file.buffer);
      if (result.kind === "duplicate") {
        res.status(409).render("message", {
          title: "Nota já cadastrada",
          message: `Esta nota já está no app (#${result.id}, ${result.status === "confirmed" ? "confirmada" : "rascunho"}).`,
          link: { href: `/receipts/${result.id}`, label: "Abrir a nota" },
        });
        return;
      }
      res.redirect(303, `/receipts/${result.id}`);
    } catch (error) {
      // ReadError: o modelo recusou ou a resposta veio cortada (nota longa demais?).
      const message =
        error instanceof ReadError
          ? error.message
          : "Não foi possível ler a nota agora. Tente de novo em instantes.";
      if (!(error instanceof ReadError)) console.error(error);
      res.status(502).render("upload", { error: message });
    }
  });

  router.get("/receipts/:id", async (req, res) => {
    const saved = await getReceipt(db, Number(req.params.id));
    if (!saved) {
      res
        .status(404)
        .render("message", { title: "Nota não encontrada", message: "" });
      return;
    }
    res.render("review", {
      ...withLineMath(await withMemory(db, saved)),
      stores: await storeNames(db, saved.receipt.store_cnpj),
      back: listUrl(req),
      errors: [],
    });
  });

  router.get("/receipts/:id/image", async (req, res) => {
    const image = await getReceiptImage(db, Number(req.params.id));
    if (!image) {
      res.sendStatus(404);
      return;
    }
    res.set("Cache-Control", "private, max-age=86400").type(image.mediaType);
    res.send(Buffer.from(image.data));
  });

  router.post("/receipts/:id/confirm", async (req, res) => {
    const id = Number(req.params.id);
    const form = parseReviewForm(req.body ?? {});
    if (!form.ok) {
      const saved = await getReceipt(db, id);
      if (!saved) {
        res.sendStatus(404);
        return;
      }
      res.status(400).render("review", {
        ...withLineMath(await withMemory(db, saved)),
        stores: await storeNames(db, saved.receipt.store_cnpj),
        back: listUrl(req),
        errors: form.errors,
      });
      return;
    }
    const before = await getReceipt(db, id);
    if (!before) {
      res.sendStatus(404);
      return;
    }
    await confirmReceipt(db, id, form.items, form.header);
    // De volta à lista (com os filtros de antes), com o aviso do que foi salvo.
    const kind = before.receipt.status === "draft" ? "confirmada" : "corrigida";
    const back = listUrl(req);
    res.redirect(303, `${back}${back.includes("?") ? "&" : "?"}${kind}=${id}`);
  });

  router.post("/receipts/:id/delete", async (req, res) => {
    await deleteReceipt(db, Number(req.params.id));
    res.redirect(303, listUrl(req));
  });

  return router;
}

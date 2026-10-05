import { type Request, Router } from "express";
import multer from "multer";
import type { AppDeps } from "../create-app.js";
import {
  clearDuplicate,
  confirmReceipt,
  deleteReceipt,
  failStaleReads,
  getReceipt,
  getReceiptImage,
  listBounds,
  listReceipts,
  requeue,
} from "../db/receipts-repo.js";
import { storeNames } from "../db/suggest-repo.js";
import { KEY_DUPLICATE_REASON } from "../services/ingest.js";
import { withLineMath, withMemory } from "../services/review.js";
import { filterQuery, groupByMonth, parseListFilter } from "./list-filter.js";
import { parseReviewForm } from "./review-form.js";

// Rotas só recebem, chamam serviços/repositório e escolhem a tela. Nada de SQL ou
// chamada à IA aqui.

const upload = multer({
  storage: multer.memoryStorage(),
  // O navegador já reduz a foto (~300 KB) e manda uma por vez; os limites cobrem o
  // envio sem JavaScript (várias fotos originais num formulário só).
  limits: { fileSize: 15 * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith("image/")),
});

export function receiptRoutes({
  db,
  accept,
  process,
  background,
}: AppDeps): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    await failStaleReads(db);
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

  // Uma ou várias fotos. Cada foto vira uma nota "lendo…" e é lida em segundo
  // plano; foto já cadastrada é recusada sem gastar a leitura. O upload.js manda uma
  // foto por vez e recebe JSON; sem JavaScript, volta para a lista.
  router.post("/receipts", upload.array("photo"), async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      res
        .status(400)
        .render("upload", { error: "Envie a foto da nota (imagem)." });
      return;
    }
    const results = [];
    for (const file of files) {
      try {
        const result = await accept(file.buffer);
        if (result.kind === "queued") background(process(result.id));
        results.push(result);
      } catch (error) {
        console.error(error);
        results.push({
          kind: "error" as const,
          message: "Não deu para abrir esta imagem.",
        });
      }
    }
    if (req.accepts(["html", "json"]) === "json") res.json({ results });
    else res.redirect(303, listUrl(req));
  });

  router.get("/receipts/:id", async (req, res) => {
    await failStaleReads(db);
    const saved = await getReceipt(db, Number(req.params.id));
    if (!saved) {
      res
        .status(404)
        .render("message", { title: "Nota não encontrada", message: "" });
      return;
    }
    // Ainda lendo, falhou ou repetida pela chave (sem itens): tela de situação.
    const { status, duplicate_reason } = saved.receipt;
    if (
      status === "processing" ||
      status === "failed" ||
      duplicate_reason === KEY_DUPLICATE_REASON
    ) {
      res.render("pending", { receipt: saved.receipt, back: listUrl(req) });
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
    const kind =
      before.receipt.status === "confirmed" ? "corrigida" : "confirmada";
    const back = listUrl(req);
    res.redirect(303, `${back}${back.includes("?") ? "&" : "?"}${kind}=${id}`);
  });

  router.post("/receipts/:id/retry", async (req, res) => {
    const id = Number(req.params.id);
    if (await requeue(db, id)) background(process(id));
    res.redirect(303, listUrl(req));
  });

  router.post("/receipts/:id/not-duplicate", async (req, res) => {
    const id = Number(req.params.id);
    await clearDuplicate(db, id);
    res.redirect(303, `/receipts/${id}`);
  });

  router.post("/receipts/:id/delete", async (req, res) => {
    await deleteReceipt(db, Number(req.params.id));
    res.redirect(303, listUrl(req));
  });

  return router;
}

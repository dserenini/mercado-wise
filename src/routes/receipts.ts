import { Router } from "express";
import multer from "multer";
import type { AppDeps } from "../create-app.js";
import {
  confirmReceipt,
  deleteReceipt,
  getReceipt,
  getReceiptImage,
  listReceipts,
} from "../db/receipts-repo.js";
import { ReadError } from "../services/reader.js";
import { withMemory } from "../services/review.js";
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

  router.get("/", async (_req, res) => {
    res.render("list", { receipts: await listReceipts(db) });
  });

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
    res.render("review", { ...(await withMemory(db, saved)), errors: [] });
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
        ...(await withMemory(db, saved)),
        errors: form.errors,
      });
      return;
    }
    await confirmReceipt(db, id, form.items, form.header);
    res.redirect(303, `/receipts/${id}?confirmed=1`);
  });

  router.post("/receipts/:id/delete", async (req, res) => {
    await deleteReceipt(db, Number(req.params.id));
    res.redirect(303, "/");
  });

  return router;
}

import { Router } from "express";
import type { AppDeps } from "../create-app.js";
import {
  type AiSettingsForm,
  aiKeyFor,
  aiSettingsView,
  PROVIDER_LABEL,
  PROVIDERS,
  saveAiSettings,
} from "../services/ai-settings.js";
import { checkAi } from "../services/claude.js";

// Tela de configurações: qual IA usar, chave e modelos de cada uma.

const field = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
// Nome de modelo: letras, números e . _ - : / (ex.: gpt-5.5, claude-sonnet-5-5).
const model = (value: unknown) => {
  const v = field(value, 100);
  return /^[\w.:/-]*$/.test(v) ? v : "";
};

export function settingsRoutes({ db, sessionSecret }: AppDeps): Router {
  const router = Router();

  router.get("/settings", async (req, res) => {
    res.render("settings", {
      settings: await aiSettingsView(db, sessionSecret),
      PROVIDERS,
      PROVIDER_LABEL,
      saved: req.query.salvo === "1",
    });
  });

  router.post("/settings", async (req, res) => {
    const body = req.body ?? {};
    const provider = PROVIDERS.find((p) => p === body.provider);
    if (!provider) {
      res.status(400).render("message", {
        title: "Configuração inválida",
        message: "Escolha uma das IAs da lista.",
      });
      return;
    }
    const form: AiSettingsForm = {
      provider,
      models: {
        anthropic: { reader: "", interpreter: "" },
        openai: { reader: "", interpreter: "" },
      },
      keys: { anthropic: "", openai: "" },
      clearKey: { anthropic: false, openai: false },
    };
    for (const p of PROVIDERS) {
      form.models[p] = {
        reader: model(body[`${p}_reader_model`]),
        interpreter: model(body[`${p}_interpreter_model`]),
      };
      form.keys[p] = field(body[`${p}_key`], 500);
      form.clearKey[p] = body[`${p}_clear_key`] === "1";
    }
    await saveAiSettings(db, sessionSecret, form);
    res.redirect(303, "/settings?salvo=1");
  });

  // Botão "Testar" (via fetch, JSON): usa a chave digitada, se houver, senão a em
  // uso; e os modelos que estão no formulário. Não salva nada.
  router.post("/settings/test", async (req, res) => {
    const body = req.body ?? {};
    const provider = PROVIDERS.find((p) => p === body.provider);
    if (!provider) {
      res.status(400).json({ ok: false, message: "IA inválida." });
      return;
    }
    const typed = field(body.key, 500);
    const problem = await checkAi(
      provider,
      typed || (await aiKeyFor(db, sessionSecret, provider)),
      [model(body.reader_model), model(body.interpreter_model)],
    );
    res.json({
      ok: problem === null,
      message: problem ?? "Chave e modelos OK.",
    });
  });

  return router;
}

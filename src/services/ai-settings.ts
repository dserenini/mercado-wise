import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { config } from "../config.js";
import type { Db } from "../db/client.js";

// Qual IA lê e interpreta as notas, com que chave e modelos. O que foi salvo na
// tela /settings vale primeiro; o que faltar vem do .env (ou variáveis da Vercel).

export const PROVIDERS = ["anthropic", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "OpenAI",
};

const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-5.5",
};

const ENV_KEY: Record<Provider, string | undefined> = {
  anthropic: config.ANTHROPIC_API_KEY,
  openai: config.OPENAI_API_KEY,
};

/** A IA em uso agora. apiKey undefined: o SDK procura sozinho (env, `ant auth login`). */
export interface AiChoice {
  provider: Provider;
  apiKey: string | undefined;
  readerModel: string;
  interpreterModel: string;
}

/** O que a tela mostra: nunca a chave, só os 4 últimos caracteres. */
export interface AiSettingsView {
  provider: Provider;
  providers: Record<
    Provider,
    {
      keyHint: string | null;
      keySource: "saved" | "env" | null;
      readerModel: string;
      interpreterModel: string;
    }
  >;
}

export interface AiSettingsForm {
  provider: Provider;
  models: Record<Provider, { reader: string; interpreter: string }>;
  /** chave nova (vazia: mantém a atual) */
  keys: Record<Provider, string>;
  clearKey: Record<Provider, boolean>;
}

async function readAll(db: Db): Promise<Map<string, string>> {
  const rows = await db.query<{ key: string; value: string }>(
    "select key, value from app.settings",
  );
  return new Map(rows.map((r) => [r.key, r.value]));
}

function resolve(
  stored: Map<string, string>,
  secret: string | undefined,
  provider: Provider,
) {
  const saved = stored.get(`${provider}.key`);
  const savedKey = saved && secret ? decrypt(saved, secret) : null;
  // Modelo do .env só vale para a IA escolhida no .env (READER_MODEL=gpt-… não
  // serve para o Claude).
  const envModel = (m: string) =>
    provider === config.AI_PROVIDER ? m : DEFAULT_MODEL[provider];
  return {
    savedKey,
    apiKey: savedKey ?? ENV_KEY[provider],
    readerModel:
      stored.get(`${provider}.reader_model`) ?? envModel(config.READER_MODEL),
    interpreterModel:
      stored.get(`${provider}.interpreter_model`) ??
      envModel(config.INTERPRETER_MODEL),
  };
}

function activeProvider(stored: Map<string, string>): Provider {
  const saved = stored.get("ai.provider");
  return PROVIDERS.find((p) => p === saved) ?? config.AI_PROVIDER;
}

export async function resolveAi(
  db: Db,
  secret = config.SESSION_SECRET,
): Promise<AiChoice> {
  const stored = await readAll(db);
  const provider = activeProvider(stored);
  const { apiKey, readerModel, interpreterModel } = resolve(
    stored,
    secret,
    provider,
  );
  return { provider, apiKey, readerModel, interpreterModel };
}

export async function aiSettingsView(
  db: Db,
  secret: string,
): Promise<AiSettingsView> {
  const stored = await readAll(db);
  const view = (provider: Provider) => {
    const r = resolve(stored, secret, provider);
    return {
      keyHint: r.apiKey ? `…${r.apiKey.slice(-4)}` : null,
      keySource: r.savedKey
        ? ("saved" as const)
        : ENV_KEY[provider]
          ? ("env" as const)
          : null,
      readerModel: r.readerModel,
      interpreterModel: r.interpreterModel,
    };
  };
  return {
    provider: activeProvider(stored),
    providers: { anthropic: view("anthropic"), openai: view("openai") },
  };
}

export async function saveAiSettings(
  db: Db,
  secret: string,
  form: AiSettingsForm,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Valor vazio apaga a linha: volta a valer o .env/padrão.
    const put = (key: string, value: string) =>
      value
        ? tx.query(
            `insert into app.settings (key, value) values ($1, $2)
             on conflict (key) do update set value = excluded.value, updated_at = now()`,
            [key, value],
          )
        : tx.query("delete from app.settings where key = $1", [key]);

    await put("ai.provider", form.provider);
    for (const p of PROVIDERS) {
      await put(`${p}.reader_model`, form.models[p].reader);
      await put(`${p}.interpreter_model`, form.models[p].interpreter);
      if (form.clearKey[p]) await put(`${p}.key`, "");
      else if (form.keys[p])
        await put(`${p}.key`, encrypt(form.keys[p], secret));
    }
  });
}

// AES-256-GCM com chave derivada do SESSION_SECRET: quem lê só o banco não vê as
// chaves. Trocar o SESSION_SECRET invalida as chaves salvas (cadastre de novo).
function cipherKey(secret: string) {
  return createHash("sha256")
    .update(`mercado-wise:settings:${secret}`)
    .digest();
}

export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cipherKey(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(":");
}

export function decrypt(sealed: string, secret: string): string | null {
  const [version, iv, tag, data] = sealed.split(":");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      cipherKey(secret),
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null; // segredo trocado ou valor adulterado
  }
}

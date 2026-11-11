import { Anthropic } from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config.js";
import type { Provider } from "./ai-settings.js";
import { openaiAsClaude } from "./openai.js";

const clients = new Map<string, Anthropic>();

/**
 * Cliente da IA com a interface `messages.parse` da Anthropic (a OpenAI vai por um
 * adaptador). Sem argumentos, usa o .env (scripts); o app passa o que está salvo
 * em /settings. O cliente de verdade só nasce na primeira chamada: sem chave, o
 * erro aparece na leitura (e vira mensagem na nota), não antes.
 */
export function aiClient(
  provider: Provider = config.AI_PROVIDER,
  apiKey?: string,
): Anthropic {
  const real = () => {
    const id = `${provider}:${apiKey ?? ""}`;
    let client = clients.get(id);
    if (!client) {
      // Envio em lote: várias leituras ao mesmo tempo podem esbarrar no limite de
      // uso da API (429); o SDK espera e tenta de novo.
      client =
        provider === "openai"
          ? openaiAsClaude(new OpenAI({ apiKey, maxRetries: 4 }))
          : new Anthropic({ apiKey, maxRetries: 4 });
      clients.set(id, client);
    }
    return client;
  };
  return {
    messages: { parse: (params: never) => real().messages.parse(params) },
  } as unknown as Anthropic;
}

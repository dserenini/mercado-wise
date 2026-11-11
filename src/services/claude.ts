import { Anthropic } from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { openaiAsClaude } from "./openai.js";

let client: Anthropic | undefined;

/**
 * Cliente único da API, criado na primeira chamada (os testes passam um falso).
 * Com AI_PROVIDER=openai, devolve a OpenAI atrás da mesma interface.
 */
export function aiClient(): Anthropic {
  // Envio em lote: várias leituras ao mesmo tempo podem esbarrar no limite de uso
  // da API (429); o SDK espera e tenta de novo.
  client ??=
    config.AI_PROVIDER === "openai"
      ? openaiAsClaude()
      : new Anthropic({ maxRetries: 4 });
  return client;
}

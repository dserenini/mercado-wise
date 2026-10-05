import { Anthropic } from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

/** Cliente único da API, criado na primeira chamada (os testes passam um falso). */
export function claudeClient(): Anthropic {
  // Envio em lote: várias leituras ao mesmo tempo podem esbarrar no limite de uso
  // da API (429); o SDK espera e tenta de novo.
  client ??= new Anthropic({ maxRetries: 4 });
  return client;
}

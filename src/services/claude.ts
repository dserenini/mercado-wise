import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

/** Cliente único da API, criado na primeira chamada (os testes passam um falso). */
export function claudeClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

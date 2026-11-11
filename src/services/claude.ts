import { Anthropic } from "@anthropic-ai/sdk";
import { OpenAI } from "openai";
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

/**
 * Botão "Testar" da tela de Configurações: confere a chave e se cada modelo existe
 * na conta, pela lista de modelos da API (não gera texto, não custa nada).
 * Devolve null se está tudo certo, ou a mensagem do problema.
 */
export async function checkAi(
  provider: Provider,
  apiKey: string | undefined,
  models: string[],
): Promise<string | null> {
  if (provider === "openai" && !apiKey) return "Nenhuma chave cadastrada.";
  for (const model of new Set(models.filter(Boolean))) {
    try {
      if (provider === "openai")
        await new OpenAI({ apiKey, maxRetries: 1 }).models.retrieve(model);
      else
        await new Anthropic({ apiKey, maxRetries: 1 }).models.retrieve(model);
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      // Sem chave e sem `ant auth login`: o SDK nem chega a chamar a API.
      if (status === undefined && !apiKey) return "Nenhuma chave cadastrada.";
      if (status === 401) return "A API recusou a chave.";
      if (status === 404) return `O modelo "${model}" não existe nesta conta.`;
      return `Não foi possível conferir agora (${(error as Error).message}).`;
    }
  }
  return null;
}

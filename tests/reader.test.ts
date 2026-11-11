import type { Anthropic } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { PreparedImage } from "../src/services/image.js";
import {
  READ_CLOSE_UPS_PROMPT_VERSION,
  READ_PROMPT_VERSION,
  ReadError,
  readReceipt,
  tidyRead,
} from "../src/services/reader.js";
import {
  item,
  receipt,
  VALID_ACCESS_KEY,
  VALID_CNPJ,
} from "./helpers/receipt.js";

describe("tidyRead", () => {
  it("deixa só dígitos no CNPJ e na chave de acesso", () => {
    const tidy = tidyRead(
      receipt({
        store: { name: null, cnpj: "11.222.333/0001-81", address: null },
        access_key: "3525 0911 2223 3300 0181 6500 1000 0123 4510 0012 3451",
      }),
    );
    expect(tidy.store.cnpj).toBe(VALID_CNPJ);
    expect(tidy.access_key).toBe(VALID_ACCESS_KEY);
  });

  it("move código curto de ean para store_code (pesável)", () => {
    const tidy = tidyRead(
      receipt({ items: [item({ ean: "2045", store_code: null })] }),
    );
    expect(tidy.items[0]?.ean).toBeNull();
    expect(tidy.items[0]?.store_code).toBe("2045");
  });

  it("move código interno com zeros à esquerda (Carrefour) para store_code", () => {
    const tidy = tidyRead(
      receipt({ items: [item({ ean: "00051570", store_code: null })] }),
    );
    expect(tidy.items[0]?.ean).toBeNull();
    expect(tidy.items[0]?.store_code).toBe("00051570");
  });

  it("mantém EAN válido mesmo começando com zeros (UPC)", () => {
    const tidy = tidyRead(
      receipt({ items: [item({ ean: "00070847022206" })] }),
    );
    expect(tidy.items[0]?.ean).toBe("00070847022206");
  });

  it("não sobrescreve store_code já lido", () => {
    const tidy = tidyRead(
      receipt({ items: [item({ ean: "12", store_code: "999" })] }),
    );
    expect(tidy.items[0]?.store_code).toBe("999");
  });

  it("transforma texto vazio em null", () => {
    const tidy = tidyRead(
      receipt({ access_key: " - ", items: [item({ store_code: "  " })] }),
    );
    expect(tidy.access_key).toBeNull();
    expect(tidy.items[0]?.store_code).toBeNull();
  });
});

describe("readReceipt", () => {
  const image: PreparedImage = {
    data: Buffer.from("fake-jpeg"),
    mediaType: "image/jpeg",
    width: 10,
    height: 10,
  };

  function fakeClient(response: Record<string, unknown>) {
    const parse = vi.fn(async (_params: Anthropic.MessageCreateParams) => ({
      model: "claude-sonnet-5-5",
      stop_reason: "end_turn",
      stop_details: null,
      usage: { input_tokens: 1500, output_tokens: 700 },
      parsed_output: receipt(),
      ...response,
    }));
    return { parse, client: { messages: { parse } } as unknown as Anthropic };
  }

  it("envia a imagem em base64 e devolve a leitura já limpa", async () => {
    const { parse, client } = fakeClient({});

    const result = await readReceipt(image, {
      client,
      model: "claude-sonnet-5-5",
    });

    expect(result.receipt.store.cnpj).toBe(VALID_CNPJ);
    expect(result.promptVersion).toBe(READ_PROMPT_VERSION);
    expect(result.usage).toEqual({ inputTokens: 1500, outputTokens: 700 });
    const params = parse.mock
      .calls[0]?.[0] as unknown as Anthropic.MessageCreateParams;
    expect(params?.model).toBe("claude-sonnet-5-5");
    expect(JSON.stringify(params?.messages)).toContain(
      image.data.toString("base64"),
    );
  });

  it("com fotos de perto: manda todas as imagens, a geral primeiro, e muda a versão", async () => {
    const { parse, client } = fakeClient({});
    const near = { ...image, data: Buffer.from("perto") };
    const result = await readReceipt(image, { client, closeUps: [near, near] });
    const params = parse.mock
      .calls[0]?.[0] as unknown as Anthropic.MessageCreateParams;
    const content = params.messages[0]
      ?.content as Anthropic.ContentBlockParam[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(3);
    expect(JSON.stringify(content[0])).toContain(image.data.toString("base64"));
    expect(result.promptVersion).toBe(READ_CLOSE_UPS_PROMPT_VERSION);
  });

  it("falha com ReadError quando o modelo recusa", async () => {
    const { client } = fakeClient({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "general_harms" },
      parsed_output: null,
    });
    await expect(readReceipt(image, { client })).rejects.toThrow(ReadError);
  });

  it("falha com ReadError quando a resposta é cortada", async () => {
    const { client } = fakeClient({
      stop_reason: "max_tokens",
      parsed_output: null,
    });
    await expect(readReceipt(image, { client })).rejects.toThrow(
      /limite de tokens/,
    );
  });
});

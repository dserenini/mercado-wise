import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { ItemRead, ReceiptRead } from "../src/schemas/receipt.js";
import type { PreparedImage } from "../src/services/image.js";
import {
  READ_PROMPT_VERSION,
  ReadError,
  readReceipt,
  tidyRead,
} from "../src/services/reader.js";

function item(overrides: Partial<ItemRead> = {}): ItemRead {
  return {
    raw_description: "AG TON SCHW ZERO 350",
    ean: "7894900360042",
    store_code: null,
    quantity: 1,
    unit: "UN",
    unit_price: 3.99,
    total_price: 3.99,
    discount: null,
    ...overrides,
  };
}

function receipt(overrides: Partial<ReceiptRead> = {}): ReceiptRead {
  return {
    is_receipt: true,
    store: {
      name: "SUPERMERCADO X",
      cnpj: "12.345.678/0001-95",
      address: null,
    },
    access_key: "3125 0912 3456 7800 0195 6500 1000 0123 4510 0012 3456",
    purchase_date: "2025-09-30",
    purchase_time: "18:42",
    items: [item()],
    items_count: 1,
    gross_total: 3.99,
    discount_total: null,
    total: 3.99,
    payment_method: "Cartão de Débito",
    quality: { orientation: "ok", flags: [], illegible_lines: [] },
    ...overrides,
  };
}

describe("tidyRead", () => {
  it("deixa só dígitos no CNPJ e na chave de acesso", () => {
    const tidy = tidyRead(receipt());
    expect(tidy.store.cnpj).toBe("12345678000195");
    expect(tidy.access_key).toBe(
      "31250912345678000195650010000123451000123456",
    );
  });

  it("move código curto de ean para store_code (pesável)", () => {
    const tidy = tidyRead(
      receipt({ items: [item({ ean: "2045", store_code: null })] }),
    );
    expect(tidy.items[0]?.ean).toBeNull();
    expect(tidy.items[0]?.store_code).toBe("2045");
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

    expect(result.receipt.store.cnpj).toBe("12345678000195");
    expect(result.promptVersion).toBe(READ_PROMPT_VERSION);
    expect(result.usage).toEqual({ inputTokens: 1500, outputTokens: 700 });
    const params = parse.mock
      .calls[0]?.[0] as unknown as Anthropic.MessageCreateParams;
    expect(params?.model).toBe("claude-sonnet-5-5");
    expect(JSON.stringify(params?.messages)).toContain(
      image.data.toString("base64"),
    );
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

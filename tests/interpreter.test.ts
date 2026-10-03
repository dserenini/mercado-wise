import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  CATEGORIES,
  type ItemInterpreted,
} from "../src/schemas/interpretation.js";
import {
  INTERPRET_PROMPT,
  INTERPRET_PROMPT_VERSION,
  type InterpretationMemory,
  InterpretError,
  interpretItems,
} from "../src/services/interpreter.js";
import { item } from "./helpers/receipt.js";

const store = { name: "SUPERMERCADO X", cnpj: "11222333000181" };

const tonica: ItemInterpreted = {
  product: "Água tônica",
  brand: "Schweppes",
  variant: "Zero",
  package_size: 350,
  package_unit: "ml",
  category: "Bebidas",
  confidence: "high",
};

const limao: ItemInterpreted = {
  product: "Limão",
  brand: null,
  variant: "Taiti",
  package_size: null,
  package_unit: null,
  category: "Hortifruti",
  confidence: "high",
};

function fakeClient(
  output: { items: (ItemInterpreted & { index: number })[] } | null,
  extra = {},
) {
  const parse = vi.fn(async (_params: Anthropic.MessageCreateParams) => ({
    model: "claude-sonnet-5-5",
    stop_reason: "end_turn",
    stop_details: null,
    usage: { input_tokens: 800, output_tokens: 300 },
    parsed_output: output,
    ...extra,
  }));
  return { parse, client: { messages: { parse } } as unknown as Anthropic };
}

const items = [
  item(),
  item({
    raw_description: "LIMAO THAITI EX.kg",
    ean: null,
    store_code: "32845",
    unit: "KG",
  }),
];

describe("interpretItems", () => {
  it("manda os itens num lote só e devolve alinhado com a entrada", async () => {
    const { parse, client } = fakeClient({
      items: [
        { index: 1, ...limao },
        { index: 0, ...tonica },
      ],
    });

    const result = await interpretItems(items, store, { client });

    expect(parse).toHaveBeenCalledTimes(1);
    expect(result.items[0]).toEqual({ ...tonica, source: "ai" });
    expect(result.items[1]).toEqual({ ...limao, source: "ai" });
    expect(result.call?.promptVersion).toBe(INTERPRET_PROMPT_VERSION);
    const sent = JSON.stringify(parse.mock.calls[0]?.[0].messages);
    expect(sent).toContain("LIMAO THAITI EX.kg");
    expect(sent).toContain("SUPERMERCADO X");
  });

  it("usa a memória e só pergunta à IA o que falta", async () => {
    const memory: InterpretationMemory = {
      find: (it) => (it.store_code === "32845" ? limao : null),
    };
    const { parse, client } = fakeClient({ items: [{ index: 0, ...tonica }] });

    const result = await interpretItems(items, store, { client, memory });

    expect(result.items[1]).toEqual({ ...limao, source: "memory" });
    expect(result.items[0]?.source).toBe("ai");
    const sent = JSON.stringify(parse.mock.calls[0]?.[0].messages);
    expect(sent).not.toContain("LIMAO");
  });

  it("não chama a API quando tudo vem da memória", async () => {
    const memory: InterpretationMemory = { find: () => tonica };
    const { parse, client } = fakeClient(null);

    const result = await interpretItems(items, store, { client, memory });

    expect(parse).not.toHaveBeenCalled();
    expect(result.call).toBeNull();
    expect(result.items.every((i) => i?.source === "memory")).toBe(true);
  });

  it("deixa null o item sem descrição e o que a IA não devolveu", async () => {
    const { parse, client } = fakeClient({
      items: [
        { index: 0, ...tonica },
        { index: 7, ...limao }, // index que não foi pedido: ignorado
      ],
    });

    const result = await interpretItems(
      [
        item(),
        item({ raw_description: null }),
        item({ raw_description: "XPTO" }),
      ],
      store,
      { client },
    );

    expect(result.items).toEqual([{ ...tonica, source: "ai" }, null, null]);
    const sent = JSON.stringify(parse.mock.calls[0]?.[0].messages);
    expect(sent).toContain("XPTO");
  });

  it("falha com InterpretError quando o modelo recusa", async () => {
    const { client } = fakeClient(null, {
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: null },
    });
    await expect(interpretItems(items, store, { client })).rejects.toThrow(
      InterpretError,
    );
  });
});

describe("INTERPRET_PROMPT", () => {
  it("define cada categoria do schema", () => {
    for (const category of CATEGORIES) {
      expect(INTERPRET_PROMPT).toContain(category);
    }
  });
});

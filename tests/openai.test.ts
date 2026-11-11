import type { OpenAI } from "openai";
import { describe, expect, it, vi } from "vitest";
import type { PreparedImage } from "../src/services/image.js";
import { openaiAsClaude } from "../src/services/openai.js";
import { ReadError, readReceipt } from "../src/services/reader.js";
import { receipt, VALID_CNPJ } from "./helpers/receipt.js";

const image: PreparedImage = {
  data: Buffer.from("fake-jpeg"),
  mediaType: "image/jpeg",
  width: 10,
  height: 10,
};

function fakeOpenAI(message: Record<string, unknown>, finish = "stop") {
  const create = vi.fn(async (_params: Record<string, unknown>) => ({
    model: "gpt-teste",
    choices: [
      {
        finish_reason: finish,
        message: { content: null, refusal: null, ...message },
      },
    ],
    usage: { prompt_tokens: 1500, completion_tokens: 700 },
  }));
  const openai = { chat: { completions: { create } } } as unknown as OpenAI;
  return { create, client: openaiAsClaude(openai) };
}

describe("openaiAsClaude (leitor pela OpenAI)", () => {
  it("manda imagem, schema estrito e esforço; devolve a leitura validada", async () => {
    const { create, client } = fakeOpenAI({
      content: JSON.stringify(receipt()),
    });

    const result = await readReceipt(image, {
      client,
      model: "gpt-teste",
      effort: "medium",
    });

    expect(result.receipt.store.cnpj).toBe(VALID_CNPJ);
    expect(result.model).toBe("gpt-teste");
    expect(result.usage).toEqual({ inputTokens: 1500, outputTokens: 700 });
    const sent = create.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      reasoning_effort: "medium",
      response_format: { json_schema: { strict: true } },
      messages: [{ role: "system" }, { role: "user" }],
    });
    expect(JSON.stringify(sent)).toContain(
      `data:image/jpeg;base64,${image.data.toString("base64")}`,
    );
  });

  it("recusa e corte viram os mesmos erros do Claude", async () => {
    const refused = fakeOpenAI({ refusal: "não posso" });
    await expect(
      readReceipt(image, { client: refused.client, model: "gpt-teste" }),
    ).rejects.toThrow(/recusou.*não posso/);

    const cut = fakeOpenAI({ content: '{"is_rec' }, "length");
    await expect(
      readReceipt(image, { client: cut.client, model: "gpt-teste" }),
    ).rejects.toThrow(ReadError);
  });

  it("avisa quando o modelo ainda é do Claude", async () => {
    const { create, client } = fakeOpenAI({});
    await expect(
      readReceipt(image, { client, model: "claude-sonnet-5-5" }),
    ).rejects.toThrow(/READER_MODEL/);
    expect(create).not.toHaveBeenCalled();
  });
});

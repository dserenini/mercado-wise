import type { Anthropic } from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionContentPart,
} from "openai/resources/chat/completions";

type Params = Anthropic.MessageCreateParams & {
  output_config: { effort?: string; format: OutputFormat };
};
interface OutputFormat {
  schema: Record<string, unknown>;
  parse: (content: string) => unknown;
}

/**
 * A API da OpenAI vestida de `messages.parse` da Anthropic: leitor e intérprete não
 * mudam. Cobre só o que eles usam (system em texto, mensagens de texto e imagem em
 * base64, saída estruturada e esforço).
 */
export function openaiAsClaude(openai: OpenAI) {
  return {
    messages: {
      async parse(params: Params) {
        if (params.model.startsWith("claude")) {
          throw new Error(
            `AI_PROVIDER=openai, mas o modelo é "${params.model}": defina ` +
              "os modelos da OpenAI em Configurações (ou READER_MODEL e INTERPRETER_MODEL no .env).",
          );
        }
        const { format, effort } = params.output_config;
        const completion = await openai.chat.completions.create({
          model: params.model,
          max_completion_tokens: params.max_tokens,
          reasoning_effort: effort as OpenAI.ReasoningEffort,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "resposta",
              strict: true,
              schema: format.schema,
            },
          },
          messages: [
            { role: "system", content: params.system as string },
            ...params.messages.map((m) => ({
              role: "user" as const,
              content: toParts(m.content),
            })),
          ],
        });
        return fromCompletion(completion, format);
      },
    },
  } as unknown as Anthropic;
}

function toParts(
  content: Anthropic.MessageParam["content"],
): string | ChatCompletionContentPart[] {
  if (typeof content === "string") return content;
  return content.map((block): ChatCompletionContentPart => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "image" && block.source.type === "base64") {
      const { media_type, data } = block.source;
      return {
        type: "image_url",
        image_url: { url: `data:${media_type};base64,${data}` },
      };
    }
    throw new Error(`Bloco "${block.type}" não suportado no adaptador OpenAI`);
  });
}

/** Resposta da OpenAI no formato que leitor e intérprete conferem. */
function fromCompletion(completion: ChatCompletion, format: OutputFormat) {
  const choice = completion.choices[0];
  const message = choice?.message;
  const stop_reason = message?.refusal
    ? "refusal"
    : choice?.finish_reason === "length"
      ? "max_tokens"
      : "end_turn";
  return {
    model: completion.model,
    stop_reason,
    stop_details: { category: message?.refusal ?? null },
    parsed_output:
      stop_reason === "end_turn" && message?.content
        ? format.parse(message.content)
        : null,
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      output_tokens: completion.usage?.completion_tokens ?? 0,
    },
  };
}

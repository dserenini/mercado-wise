import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type Config, config } from "../config.js";
import {
  CATEGORIES,
  type ItemInterpreted,
  ItemInterpretedSchema,
} from "../schemas/interpretation.js";
import type { ItemRead } from "../schemas/receipt.js";
import { claudeClient } from "./claude.js";

export const INTERPRET_PROMPT_VERSION = "interpret-v1";

// Ponto de partida: legacy-v0 backend/app/services/ai_normalizer.py. Mudança principal:
// o antigo apagava sabor/variante ("Monster Ultra" → "Energético Monster"); aqui a
// variante tem campo próprio e nada se perde.
export const INTERPRET_PROMPT = `\
Você interpreta descrições de produtos impressas em cupons fiscais de supermercados \
brasileiros. As descrições são abreviadas pelo sistema de cada mercado (ex.: \
"CHO.LACT.DI.N.80G"). Para cada item, devolva:

- product: o nome genérico do produto em português, em minúsculas exceto a primeira \
letra, no singular, SEM marca, SEM tamanho e SEM sabor/variante. Use sempre o nome mais \
comum, para que o mesmo produto receba o mesmo nome em qualquer nota: "Chocolate ao \
leite", "Energético", "Leite condensado", "Pão francês", "Limão".
- brand: a marca com a grafia oficial ("Lacta", "Itambé", "Coca-Cola"). Marca própria \
do mercado também conta. null para hortifruti, carne sem marca, pão da casa ou quando \
não houver marca na descrição.
- variant: sabor, linha, tipo ou variedade que diferencia produtos de mesmo nome: \
"Diamante Negro", "Zero", "Sem sal", "Integral", "Taiti", "Prata". null se não houver. \
Classificação de qualidade ("EXT", "EXTRA", "ESP", "PREMIUM") não é variante: descarte.
- package_size e package_unit: o conteúdo da embalagem quando estiver na descrição \
("80G" → 80 g; "1L" → 1 l; "C/4" → 4 un; "1,6KG" → 1.6 kg). Itens vendidos a peso \
(unidade KG na nota) ficam null: o peso é a quantidade comprada, não a embalagem.
- category: uma das categorias da lista.
- confidence: "high" se a leitura da abreviação é segura; "medium" se é provável; \
"low" se a abreviação é ambígua e o nome pode estar errado. Prefira "low" a um \
palpite confiante: o usuário revisa os itens marcados.

O EAN, quando informado, identifica o produto, mas não tente adivinhar o produto pelo \
número: use a descrição. Devolva exatamente um resultado por item, com o mesmo index.

Exemplos (descrição → product | brand | variant | embalagem | category):
- "CHO.LACT.DI.N.80G" → Chocolate ao leite | Lacta | Diamante Negro | 80 g | Mercearia
- "AG TON SCHW ZERO 350" → Água tônica | Schweppes | Zero | 350 ml | Bebidas
- "LTE COND PIRAC 395G" → Leite condensado | Piracanjuba | null | 395 g | Mercearia
- "LIMAO THAITI EX.kg" → Limão | null | Taiti | null | Hortifruti
- "PAO FR.ASS.kg" → Pão francês | null | null | null | Padaria

Categorias: ${CATEGORIES.join(", ")}.`;

/** Onde ficam as interpretações já confirmadas pelo usuário (preenchida na Fase 5/6). */
export interface InterpretationMemory {
  find(item: ItemRead, store: StoreContext): ItemInterpreted | null;
}

export const emptyMemory: InterpretationMemory = { find: () => null };

export interface StoreContext {
  name: string | null;
  cnpj: string | null;
}

export interface InterpretedItem extends ItemInterpreted {
  source: "memory" | "ai";
}

export interface InterpretResult {
  /** Alinhado com os itens de entrada; null quando não deu para interpretar (descrição ilegível). */
  items: (InterpretedItem | null)[];
  /** null quando tudo veio da memória e não houve chamada à API */
  call: {
    model: string;
    promptVersion: string;
    usage: { inputTokens: number; outputTokens: number };
    latencyMs: number;
  } | null;
}

export class InterpretError extends Error {
  override name = "InterpretError";
}

const BatchSchema = z.object({
  items: z.array(ItemInterpretedSchema.extend({ index: z.number().int() })),
});

type Effort = Config["INTERPRETER_EFFORT"];

/** Etapa INTERPRETAR: descrição crua → produto, marca, variante, embalagem, categoria. */
export async function interpretItems(
  items: ItemRead[],
  store: StoreContext,
  options: {
    client?: Anthropic;
    model?: string;
    effort?: Effort;
    memory?: InterpretationMemory;
  } = {},
): Promise<InterpretResult> {
  const memory = options.memory ?? emptyMemory;
  const result: (InterpretedItem | null)[] = items.map(() => null);

  // 1) Memória primeiro: o que já foi confirmado não passa pela IA de novo.
  const pending: { index: number; item: ItemRead }[] = [];
  items.forEach((item, index) => {
    if (item.raw_description === null) return;
    const remembered = memory.find(item, store);
    if (remembered) result[index] = { ...remembered, source: "memory" };
    else pending.push({ index, item });
  });
  if (pending.length === 0) return { items: result, call: null };

  // 2) O resto vai num lote único para a IA.
  const client = options.client ?? claudeClient();
  const model = options.model ?? config.INTERPRETER_MODEL;
  const effort = options.effort ?? config.INTERPRETER_EFFORT;
  const input = pending.map(({ index, item }) => ({
    index,
    description: item.raw_description,
    unit: item.unit,
    ean: item.ean,
  }));

  const started = performance.now();
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    system: INTERPRET_PROMPT,
    output_config: { effort, format: zodOutputFormat(BatchSchema) },
    messages: [
      {
        role: "user",
        content:
          `Mercado: ${store.name ?? "desconhecido"}\n` +
          `Itens:\n${JSON.stringify(input, null, 1)}`,
      },
    ],
  });
  const latencyMs = Math.round(performance.now() - started);

  if (response.stop_reason === "refusal") {
    throw new InterpretError(
      `O modelo recusou a interpretação (${response.stop_details?.category ?? "?"})`,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new InterpretError("Resposta cortada no limite de tokens");
  }
  if (!response.parsed_output) {
    throw new InterpretError("Resposta fora do schema esperado");
  }

  // Só aceita resultado para um index que foi pedido; o que faltar fica null.
  const asked = new Set(pending.map((p) => p.index));
  for (const { index, ...interpreted } of response.parsed_output.items) {
    if (asked.has(index)) result[index] = { ...interpreted, source: "ai" };
  }

  return {
    items: result,
    call: {
      model: response.model,
      promptVersion: INTERPRET_PROMPT_VERSION,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      latencyMs,
    },
  };
}

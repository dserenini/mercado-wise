import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { type Config, config } from "../config.js";
import {
  type ItemInterpreted,
  ItemInterpretedSchema,
} from "../schemas/interpretation.js";
import type { ItemRead } from "../schemas/receipt.js";
import { claudeClient } from "./claude.js";

// v2: ajustada com a revisão manual de 168 itens (eval/ground-truth/interpretation-v1.json).
// v3: marca reconhecida pelo conhecimento das marcas típicas do produto (a v2 copiava o
// trecho), espécie sempre na variante (inclusive frango), sem trocar o tipo de produto.
export const INTERPRET_PROMPT_VERSION = "interpret-v3";

// Ponto de partida: legacy-v0 backend/app/services/ai_normalizer.py. Mudança principal:
// o antigo apagava sabor/variante ("Monster Ultra" → "Energético Monster"); aqui a
// variante tem campo próprio e nada se perde.
export const INTERPRET_PROMPT = `\
Você interpreta descrições de produtos impressas em cupons fiscais de supermercados \
brasileiros. As descrições são abreviadas pelo sistema de cada mercado (ex.: \
"CHO.LACT.DI.N.80G"). O objetivo é comparar preços: o mesmo produto precisa receber \
exatamente os mesmos campos em qualquer nota e em qualquer mercado. Para cada item, \
devolva:

- product: o nome genérico em português, com só a primeira letra maiúscula, no singular, \
SEM marca, SEM tamanho e SEM sabor/variedade. O que muda a natureza do produto faz parte \
do nome ("Batata congelada", "Batata palha", "Leite em pó", "Leite condensado", \
"Azeitona verde"); o que só diferencia versões do mesmo produto vai para variant \
("Linguiça" + "Mista", "Biscoito" + "Maizena", "Biscoito" + "Rosquinha"; nunca \
"Linguiça mista" ou "Biscoito maizena"). Use sempre o nome mais comum: \
"Chocolate ao leite", "Energético", "Pão francês", "Isotônico", "Azeite", \
"Requeijão", "Limpador" + "Cremoso", "Tapioca" + "Hidratada". Exceção ao singular: \
"Ovos".
- brand: a marca com a grafia oficial ("Lacta", "Itambé", "Coca-Cola", "Müller"). \
Marca própria do mercado também conta. Nas descrições, a marca costuma vir abreviada \
depois do nome. Reconheça-a usando o que você sabe das marcas típicas DAQUELE produto \
no Brasil: o trecho abreviado + o tipo de produto quase sempre bastam ("CAFE PIL" → \
Pilão; "MAC ADRIA" → Adria; "REFRI GUAR ANT" → Antarctica; MUL = Müller, PAMP/PAM = \
Pamplona, SE/SEAR = Seara, SPIT = Sprite, M MAIS = Minas Mais). Só quando nenhuma \
marca conhecida combinar com o trecho e com o produto, use o trecho como está, com só \
a primeira letra maiúscula ("XAP" → "Xap"), e marque confidence "low". Nunca invente \
marca a partir de uma letra solta nem inclua marca que não esteja indicada na \
descrição. null para hortifruti, carne sem marca, pão da casa ou quando não houver \
trecho de marca.
- variant: o que diferencia produtos de mesmo nome. Quando houver tipo e sabor ao \
mesmo tempo, junte os dois, tipo primeiro e só a primeira letra maiúscula: \
"Maizena chocolate", "Rosquinha coco". Fora isso, siga esta ordem de prioridade \
quando houver mais de uma opção:
  1. espécie em carnes e aves: "Bovino", "Suíno", "Frango", "Peixe" (concordando com o \
produto: "Filé mignon" + "Suíno", "Alcatra" + "Bovina", "Filé de peito" + "Frango", \
"Sobrecoxa" + "Frango"). A espécie nunca vai no nome do produto ("Filé de peito", \
nunca "Filé de peito de frango"). Marca de suínos (Pamplona) indica carne suína;
  2. sabor, linha, tipo ou variedade: "Diamante Negro", "Zero", "Sem sal", "Mista", \
"Uva", "Taiti", "Caturra", "Andrea", "Prata";
  3. formato: "Pedaço" (PED), "Fatiado".
  Não são variante: classificação de qualidade ("EXT", "EXTRA", "ESP", "PREMIUM") e \
descritores genéricos que não distinguem nada ("Original", "100%"). Na dúvida, null.
- package_size e package_unit: o conteúdo da embalagem quando estiver na descrição \
("80G" → 80 g; "1L" → 1 l; "C/4" → 4 un; "1,6KG" → 1.6 kg). Itens vendidos a peso \
(unidade KG na nota) ficam null: o peso é a quantidade comprada, não a embalagem.
- category: uma das categorias abaixo.
- confidence: "high" se a leitura da abreviação é segura; "medium" se é provável; \
"low" se a abreviação é ambígua e algum campo pode estar errado. Prefira "low" a um \
palpite confiante: o usuário revisa os itens marcados.

Mantenha o tipo de produto que a abreviação indica; não troque por um produto parecido \
(MOL = molho, não ketchup). Item vendido por kg com classificação EX/EXT/ESP no nome \
quase sempre é hortifruti: leia a abreviação como fruta, legume ou verdura. \
Siglas no fim da descrição que indicam embalagem ou unidade de venda (BJ = bandeja, \
PT = pacote, TP, UN, CX, VD, FR, LT, KG) não são marca nem variante, nem embalagem: \
alface vendida por "UN" fica com embalagem null. O EAN, quando \
informado, identifica o produto, mas não tente adivinhar o produto pelo número: use a \
descrição. Devolva exatamente um resultado por item, com o mesmo index.

Exemplos (descrição → product | brand | variant | embalagem | category):
- "CHO.LACT.DI.N.80G" → Chocolate ao leite | Lacta | Diamante Negro | 80 g | Doces
- "AG TON SCHW ZERO 350" → Água tônica | Schweppes | Zero | 350 ml | Bebidas
- "QJO.PED.MUS.MUL.kg" → Queijo muçarela | Müller | Pedaço | null | Frios e laticínios
- "FIL.MIG.S.T.PAM.kg" → Filé mignon | Pamplona | Suíno | null | Açougue e peixaria
- "FI.PE.FG.SE.1KG BJ" → Filé de peito | Seara | Frango | 1 kg | Açougue e peixaria
- "LING.MISTA PERD.kg" → Linguiça | Perdigão | Mista | null | Açougue e peixaria
- "BISC MABEL ROSQ 500G" → Biscoito | Mabel | Rosquinha | 500 g | Mercearia
- "ROSQ.MAB.COCO 500G" → Biscoito | Mabel | Rosquinha coco | 500 g | Mercearia
- "BATATA CON.UAI 2KG" → Batata congelada | Uai | null | 2 kg | Congelados
- "ACUCA.CR.LACUC.2KG" → Açúcar | Laçucar | Cristal | 2 kg | Básicos
- "TOMATE ANDR.EXT.kg" → Tomate | null | Andrea | null | Hortifruti
- "PAO FR.ASS.kg" → Pão francês | null | null | null | Padaria

Categorias:
- Hortifruti: frutas, legumes e verduras (ovos vão para Mercearia).
- Açougue e peixaria: carnes, aves, peixes e linguiças, frescos ou congelados.
- Frios e laticínios: queijos, requeijão, iogurte, manteiga, margarina, presunto.
- Padaria: pães, bolos e salgados de padaria.
- Básicos: arroz, feijão, açúcar, sal, farinhas, tapioca, óleo, café, macarrão.
- Mercearia: os demais industrializados de despensa: molhos, conservas, enlatados, \
temperos, biscoitos, salgadinhos, leite em pó, leite condensado, creme de leite, ovos.
- Doces: chocolates, balas, confeitos, paçoca, doces em geral.
- Bebidas: água, sucos, refrigerantes, isotônicos, energéticos, cerveja sem álcool.
- Bebidas alcoólicas: cerveja, vinho, destilados.
- Congelados: pratos e alimentos prontos congelados (batata congelada, pizza, sorvete). \
Carne e frango congelados vão para Açougue e peixaria.
- Limpeza, Higiene e beleza, Bebê, Pet, Utilidades e bazar: pelo nome.
- Outros: só se nada acima servir.`;

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

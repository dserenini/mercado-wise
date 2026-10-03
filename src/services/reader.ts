import type { Anthropic } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type Config, config } from "../config.js";
import {
  type ItemRead,
  type ReceiptRead,
  ReceiptReadSchema,
} from "../schemas/receipt.js";
import { claudeClient } from "./claude.js";
import type { PreparedImage } from "./image.js";

// Suba a versão sempre que mudar o prompt: ela vai para o banco junto com cada
// leitura, para comparar resultados entre versões.
export const READ_PROMPT_VERSION = "read-v1";

// Portado de legacy-v0: backend/app/services/vision/base.py (EXTRACTION_PROMPT).
// O formato da resposta não é descrito aqui: quem garante é o structured outputs.
export const READ_PROMPT = `\
Você transcreve cupons fiscais brasileiros (NFC-e, "Documento Auxiliar da Nota Fiscal \
de Consumidor Eletrônica") a partir de uma foto. Seu trabalho é só TRANSCREVER o que está \
impresso: interpretar os nomes e conferir as contas são etapas posteriores.

Regras:
1. Transcreva literalmente. Se algum caractere de um campo estiver ilegível (borrão, \
sombra, dobra, reflexo, algo cobrindo), use null no campo inteiro. Não complete dígitos \
por dedução, nem para fazer a conta fechar: uma conta que não fecha é um sinal útil para \
a etapa seguinte; um dígito inventado, não.
2. A foto pode estar girada ou de cabeça para baixo. Leia mesmo assim e informe em \
quality.orientation.
3. Itens: um por item da tabela (colunas típicas: Código, Descrição, Qtd, Un, Vl Unit, \
Vl Total), na ordem impressa. Um item pode ocupar duas linhas (descrição numa, quantidade \
e preços na seguinte): junte-as num só item. Alguns layouts trazem, entre parênteses \
depois do preço unitário, o valor aproximado de tributos (coluna "VLTR"): isso não é \
preço nem desconto; ignore.
   - ean: o código da coluna Código quando tiver de 8 a 14 dígitos (produto embalado).
   - store_code: se o código for curto (menos de 8 dígitos, típico de hortifruti e \
açougue pesados na balança), coloque-o aqui e deixe ean null.
   - raw_description: só o nome, como impresso e abreviado (ex.: "AG TON SCHW ZERO 350"). \
Sem quantidade, unidade ou preço, e sem expandir abreviações.
   - quantity, unit_price, total_price: números com ponto decimal (1,5 → 1.5; \
12,99 → 12.99).
   - discount: se houver uma linha de desconto logo abaixo do item, informe o valor \
(positivo) nesse item. Não crie um item para a linha de desconto.
4. Rodapé: items_count ("Qtd. total de itens"), gross_total ("Valor total R$"), \
discount_total ("Descontos R$"), total ("Valor a pagar R$") e payment_method. Se a nota \
trouxer só um total, coloque-o em total e deixe gross_total null.
5. Cabeçalho: nome do emitente, CNPJ e endereço; chave de acesso (44 dígitos, \
geralmente em grupos de 4 perto do QR Code); data (AAAA-MM-DD) e hora (HH:MM) de emissão. \
CNPJ e chave de acesso só com dígitos.
6. quality: marque os problemas da foto em flags (blurry, dark, glare, cropped se parte \
da nota ficou fora da foto, folded) e liste em illegible_lines os trechos de item que \
você não conseguiu ler com segurança.
7. Se a imagem não for um cupom fiscal, devolva is_receipt = false e items vazio.`;

export type Effort = Config["READER_EFFORT"];

export interface ReadResult {
  receipt: ReceiptRead;
  model: string;
  promptVersion: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export class ReadError extends Error {
  override name = "ReadError";
}

/** Etapa LER: foto → o que está impresso, como ReceiptRead. Não interpreta, não valida. */
export async function readReceipt(
  image: PreparedImage,
  options: { client?: Anthropic; model?: string; effort?: Effort } = {},
): Promise<ReadResult> {
  const client = options.client ?? claudeClient();
  const model = options.model ?? config.READER_MODEL;
  const effort = options.effort ?? config.READER_EFFORT;

  const started = performance.now();
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    system: READ_PROMPT,
    output_config: { effort, format: zodOutputFormat(ReceiptReadSchema) },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: image.mediaType,
              data: image.data.toString("base64"),
            },
          },
          { type: "text", text: "Transcreva este cupom fiscal." },
        ],
      },
    ],
  });
  const latencyMs = Math.round(performance.now() - started);

  if (response.stop_reason === "refusal") {
    throw new ReadError(
      `O modelo recusou a leitura (${response.stop_details?.category ?? "?"})`,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new ReadError(
      "Resposta cortada no limite de tokens (nota longa demais?)",
    );
  }
  if (!response.parsed_output) {
    throw new ReadError("Resposta fora do schema esperado");
  }

  return {
    receipt: tidyRead(response.parsed_output),
    model: response.model,
    promptVersion: READ_PROMPT_VERSION,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    latencyMs,
  };
}

/**
 * Limpeza determinística depois da leitura (portada de `ReceiptExtraction.from_payload`):
 * deixa só dígitos em CNPJ/chave/EAN e move código curto de "ean" para "store_code" —
 * o modelo às vezes põe o código de balança no lugar do EAN.
 */
export function tidyRead(receipt: ReceiptRead): ReceiptRead {
  return {
    ...receipt,
    store: { ...receipt.store, cnpj: digitsOnly(receipt.store.cnpj) },
    access_key: digitsOnly(receipt.access_key),
    items: receipt.items.map(tidyItem),
  };
}

function tidyItem(item: ItemRead): ItemRead {
  let ean = digitsOnly(item.ean);
  let storeCode = item.store_code?.trim() || null;
  if (ean !== null && ean.length < 8) {
    storeCode ??= ean;
    ean = null;
  }
  return { ...item, ean, store_code: storeCode };
}

function digitsOnly(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replace(/\D/g, "");
  return digits === "" ? null : digits;
}

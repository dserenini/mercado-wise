import { z } from "zod";

// Contrato da etapa LER: o que está impresso na nota, sem interpretação.
// Este schema vira três coisas: o tipo TS (z.infer), o JSON Schema que o Claude
// é obrigado a seguir (structured outputs) e a validação da resposta.
// Valores em reais, como impressos; a conversão para centavos acontece depois.

export const ItemReadSchema = z.object({
  raw_description: z
    .string()
    .nullable()
    .describe(
      "Descrição exatamente como impressa (abreviada), sem qtd/unidade/preço",
    ),
  ean: z
    .string()
    .nullable()
    .describe(
      "Código de barras (8 a 14 dígitos) da coluna Código; null se curto ou ilegível",
    ),
  store_code: z
    .string()
    .nullable()
    .describe(
      "Código interno curto (< 8 dígitos, ex.: balança/hortifruti) quando não há EAN",
    ),
  quantity: z
    .number()
    .nullable()
    .describe("Quantidade, com ponto decimal (ex.: 0.456)"),
  unit: z
    .string()
    .nullable()
    .describe("Unidade impressa: UN, KG, LT, PT, BJ, CX..."),
  unit_price: z.number().nullable().describe("Preço unitário em reais"),
  total_price: z.number().nullable().describe("Total da linha em reais"),
  discount: z
    .number()
    .nullable()
    .describe(
      "Desconto aplicado a este item em reais (valor positivo); null se não houver",
    ),
});

export const ReceiptReadSchema = z.object({
  is_receipt: z.boolean().describe("false se a foto não for um cupom fiscal"),
  store: z.object({
    name: z.string().nullable().describe("Razão social ou nome do emitente"),
    cnpj: z.string().nullable().describe("CNPJ do emitente, só dígitos"),
    address: z.string().nullable(),
  }),
  access_key: z
    .string()
    .nullable()
    .describe("Chave de acesso de 44 dígitos, só dígitos"),
  purchase_date: z
    .string()
    .nullable()
    .describe("Data de emissão no formato AAAA-MM-DD"),
  purchase_time: z
    .string()
    .nullable()
    .describe("Hora de emissão no formato HH:MM"),
  items: z
    .array(ItemReadSchema)
    .describe("Itens na ordem em que aparecem impressos"),
  items_count: z
    .number()
    .nullable()
    .describe("'Qtd. total de itens' impressa no rodapé"),
  gross_total: z
    .number()
    .nullable()
    .describe("'Valor total' antes dos descontos, em reais"),
  discount_total: z
    .number()
    .nullable()
    .describe("'Descontos' totais, em reais (positivo)"),
  total: z.number().nullable().describe("'Valor a pagar' em reais"),
  payment_method: z
    .string()
    .nullable()
    .describe("Forma de pagamento como impressa"),
  quality: z.object({
    orientation: z.enum(["ok", "rotated", "upside_down"]),
    flags: z.array(z.enum(["blurry", "dark", "glare", "cropped", "folded"])),
    illegible_lines: z
      .array(z.string())
      .describe("Trechos de linhas de item que não deu para ler com segurança"),
  }),
});

export type ItemRead = z.infer<typeof ItemReadSchema>;
export type ReceiptRead = z.infer<typeof ReceiptReadSchema>;

import { z } from "zod";

// Contrato da etapa INTERPRETAR: a descrição crua da nota vira dados de produto.
// `product` é o nome genérico que agrupa comparações de preço (sem marca, tamanho
// nem sabor); o resto fica em campos próprios para nada se perder.

export const CATEGORIES = [
  "Hortifruti",
  "Açougue e peixaria",
  "Frios e laticínios",
  "Padaria",
  "Mercearia",
  "Bebidas",
  "Bebidas alcoólicas",
  "Congelados",
  "Limpeza",
  "Higiene e beleza",
  "Bebê",
  "Pet",
  "Utilidades e bazar",
  "Outros",
] as const;

export const ItemInterpretedSchema = z.object({
  product: z
    .string()
    .describe(
      "Nome genérico, sem marca/tamanho/sabor. Ex.: 'Chocolate ao leite'",
    ),
  brand: z
    .string()
    .nullable()
    .describe("Marca com a grafia oficial. Ex.: 'Lacta'. null se não houver"),
  variant: z
    .string()
    .nullable()
    .describe("Sabor, linha ou tipo. Ex.: 'Diamante Negro', 'Zero', 'Taiti'"),
  package_size: z
    .number()
    .nullable()
    .describe("Conteúdo da embalagem. Ex.: 80"),
  package_unit: z.enum(["g", "kg", "ml", "l", "un"]).nullable(),
  category: z.enum(CATEGORIES),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("low quando a abreviação é ambígua e o nome pode estar errado"),
});

export type ItemInterpreted = z.infer<typeof ItemInterpretedSchema>;
export type Category = (typeof CATEGORIES)[number];

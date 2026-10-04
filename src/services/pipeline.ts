import type { ReceiptRead } from "../schemas/receipt.js";
import { annotate, completeLines } from "./derive.js";
import { type PreparedImage, prepareImage } from "./image.js";
import {
  type InterpretationMemory,
  type InterpretResult,
  interpretItems,
} from "./interpreter.js";
import { type ReadResult, readReceipt } from "./reader.js";
import { type ReceiptValidation, validateReceipt } from "./validators.js";

export interface PhotoRead {
  image: PreparedImage;
  read: ReadResult;
}

export interface PipelineResult extends PhotoRead {
  /** a leitura com as contas das linhas completadas (read.receipt fica como a IA leu) */
  receipt: ReceiptRead;
  validation: ReceiptValidation;
  interpretation: InterpretResult;
}

/** Etapa 1: preparar a foto e ler a nota (uma chamada à IA). */
export async function readPhoto(photo: Buffer): Promise<PhotoRead> {
  const image = await prepareImage(photo);
  const read = await readReceipt(image);
  return { image, read };
}

/**
 * Etapas 2 e 3: completar as contas das linhas e validar (sem IA), depois interpretar
 * (memória primeiro, IA para o resto).
 */
export async function completeReading(
  { image, read }: PhotoRead,
  options: { memory?: InterpretationMemory } = {},
): Promise<PipelineResult> {
  const { receipt, lines } = completeLines(read.receipt);
  const checked = validateReceipt(receipt);
  const validation = {
    ...checked,
    items: checked.items.map((item, i) => {
      const line = lines[i];
      return line ? { ...item, problems: annotate(item.problems, line) } : item;
    }),
  };
  const interpretation =
    receipt.is_receipt && receipt.items.length > 0
      ? await interpretItems(receipt.items, receipt.store, options)
      : { items: [], call: null };
  return { image, read, receipt, validation, interpretation };
}

/**
 * Foto → ler → validar → interpretar. Não grava nada: quem chama decide (a tela de
 * revisão mostra; só a confirmação do usuário grava).
 */
export async function processReceiptPhoto(
  photo: Buffer,
  options: { memory?: InterpretationMemory } = {},
): Promise<PipelineResult> {
  return completeReading(await readPhoto(photo), options);
}

import { prepareImage } from "./image.js";
import {
  type InterpretationMemory,
  type InterpretResult,
  interpretItems,
} from "./interpreter.js";
import { type ReadResult, readReceipt } from "./reader.js";
import { type ReceiptValidation, validateReceipt } from "./validators.js";

export interface PipelineResult {
  image: { width: number; height: number };
  read: ReadResult;
  validation: ReceiptValidation;
  interpretation: InterpretResult;
}

/**
 * Foto → ler → validar → interpretar. Não grava nada: devolve tudo para quem chamou
 * decidir (a tela de revisão mostra; só a confirmação do usuário grava).
 */
export async function processReceiptPhoto(
  photo: Buffer,
  options: { memory?: InterpretationMemory } = {},
): Promise<PipelineResult> {
  const image = await prepareImage(photo);
  const read = await readReceipt(image);
  const validation = validateReceipt(read.receipt);

  const { receipt } = read;
  const interpretation =
    receipt.is_receipt && receipt.items.length > 0
      ? await interpretItems(receipt.items, receipt.store, options)
      : { items: [], call: null };

  return {
    image: { width: image.width, height: image.height },
    read,
    validation,
    interpretation,
  };
}

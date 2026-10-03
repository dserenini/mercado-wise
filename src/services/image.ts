import sharp from "sharp";

// Limites de imagem do Claude (Sonnet 5.5 / Opus 5.5): lado maior até 2576 px e
// até ~3,75 MP. Acima disso a API reduz sozinha; reduzindo antes, controlamos a
// qualidade e não pagamos upload à toa. Cupom é comprido: o lado maior importa.
export const MAX_LONG_EDGE = 2576;
export const MAX_PIXELS = 3_750_000;

export interface PreparedImage {
  data: Buffer;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

/** Tamanho final que cabe nos dois limites, mantendo a proporção. Nunca amplia. */
export function targetSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const byEdge = MAX_LONG_EDGE / Math.max(width, height);
  const byArea = Math.sqrt(MAX_PIXELS / (width * height));
  const scale = Math.min(1, byEdge, byArea);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/** Endireita pela orientação EXIF do celular, reduz para os limites e converte para JPEG. */
export async function prepareImage(input: Buffer): Promise<PreparedImage> {
  const meta = await sharp(input).metadata();
  // `autoOrient` traz as dimensões já com a rotação EXIF aplicada.
  const size = targetSize(meta.autoOrient.width, meta.autoOrient.height);

  const { data, info } = await sharp(input)
    .autoOrient()
    .resize(size.width, size.height)
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    mediaType: "image/jpeg",
    width: info.width,
    height: info.height,
  };
}

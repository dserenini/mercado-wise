import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  MAX_LONG_EDGE,
  MAX_PIXELS,
  prepareImage,
  targetSize,
} from "../src/services/image.js";

describe("targetSize", () => {
  it("não amplia imagem pequena", () => {
    expect(targetSize(800, 1200)).toEqual({ width: 800, height: 1200 });
  });

  it("limita o lado maior (cupom comprido)", () => {
    expect(targetSize(1000, 5152)).toEqual({
      width: 500,
      height: MAX_LONG_EDGE,
    });
  });

  it("limita a área quando o lado maior já cabe", () => {
    const { width, height } = targetSize(2500, 2500);
    expect(width * height).toBeLessThanOrEqual(MAX_PIXELS);
    expect(width).toBe(height);
  });
});

describe("prepareImage", () => {
  it("aplica a rotação EXIF antes de reduzir e devolve JPEG", async () => {
    // Foto "deitada" de 4000x1000 com EXIF dizendo "gire 90°" → em pé, 1000x4000.
    const photo = await sharp({
      create: { width: 4000, height: 1000, channels: 3, background: "#fff" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const prepared = await prepareImage(photo);

    expect(prepared.mediaType).toBe("image/jpeg");
    expect(prepared.height).toBe(MAX_LONG_EDGE);
    expect(prepared.width).toBe(644);
    const meta = await sharp(prepared.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect([undefined, 1]).toContain(meta.orientation);
  });
});

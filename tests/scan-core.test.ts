import { describe, expect, it } from "vitest";
import {
  decide,
  findOverlap,
  type Gray,
  LIMITS,
  motion,
  sharpness,
  toGray,
} from "../public/static/scan-core.js";

// Nota de mentira: 120 px de largura, linhas de "texto" (blocos escuros de largura
// aleatória) separadas por espaço branco, como um cupom.
function receipt(height: number, seed = 7): Gray {
  let x = seed;
  const rand = () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
  const w = 120;
  const data = new Float32Array(w * height).fill(235);
  for (let y = 0; y < height; y += 7) {
    let col = 4 + Math.floor(rand() * 6);
    while (col < w - 6) {
      const len = 2 + Math.floor(rand() * 9);
      for (let yy = y; yy < Math.min(height, y + 4); yy++)
        for (let xx = col; xx < Math.min(w, col + len); xx++)
          data[yy * w + xx] = 30;
      col += len + 1 + Math.floor(rand() * 4);
    }
  }
  return { data, w, h: height };
}

/** Quadro da câmera: janela de `h` linhas a partir de `top`. */
const view = (r: Gray, top: number, h = 200): Gray => ({
  data: r.data.slice(top * r.w, (top + h) * r.w),
  w: r.w,
  h,
});

describe("scan-core", () => {
  const nota = receipt(1200);

  it("acha a faixa do trecho anterior no quadro atual e diz quanto desceu", () => {
    const first = view(nota, 0);
    // Desceu 144 linhas (72% de 200): a faixa (72–92%) fica no topo do novo quadro.
    const ready = findOverlap(first, view(nota, 144));
    expect(ready.score).toBeGreaterThan(LIMITS.goodOverlap);
    expect(ready.offset).toBeLessThan(0.05);
    // Desceu só 60: a faixa está no meio → "desça mais".
    const early = findOverlap(first, view(nota, 60));
    expect(early.offset).toBeCloseTo(84 / 200, 1);
    expect(
      decide({ steadyFor: 1000, sharp: 10, bestSharp: 10, overlap: early }),
    ).toBe("down");
    // Desceu demais (a faixa saiu da tela): linhas parecidas "batem" em outro lugar,
    // mas fraco; nunca vira captura sem sobreposição.
    for (const top of [160, 190, 250, 400, 700]) {
      const lost = findOverlap(first, view(nota, top));
      expect(
        decide({ steadyFor: 1000, sharp: 10, bestSharp: 10, overlap: lost }),
      ).toBe("back");
    }
  });

  it("só captura parada e nítida", () => {
    const base = { sharp: 10, bestSharp: 10, overlap: null };
    expect(decide({ ...base, steadyFor: 100 })).toBe("hold");
    expect(decide({ ...base, steadyFor: 1000 })).toBe("capture");
    expect(decide({ ...base, steadyFor: 1000, sharp: 5 })).toBe("blurry"); // < 70% da melhor
    expect(
      decide({ steadyFor: 1000, sharp: 2, bestSharp: 2, overlap: null }),
    ).toBe("blurry");
  });

  it("nitidez cai quando borra; movimento ≈ 0 parado e alto mexendo", () => {
    const frame = view(nota, 0);
    const blurred: Gray = {
      ...frame,
      data: frame.data.map(
        (v, i, a) => (v + (a[i + 1] ?? v) + (a[i + 120] ?? v)) / 3,
      ),
    };
    expect(sharpness(blurred)).toBeLessThan(sharpness(frame) * 0.8);
    expect(motion(frame, view(nota, 0))).toBe(0);
    expect(motion(frame, view(nota, 3))).toBeGreaterThan(LIMITS.steadyMotion);
  });

  it("toGray reduz o RGBA mantendo a proporção", () => {
    const rgba = new Uint8ClampedArray(240 * 100 * 4).fill(255);
    const g = toGray(rgba, 240, 100, 120);
    expect([g.w, g.h]).toEqual([120, 50]);
    expect(g.data[0]).toBeCloseTo(255, 0);
  });
});

// Escaneamento guiado da nota comprida: as contas, sem tela (testadas em
// tests/scan-core.test.ts). Tudo trabalha numa versão pequena e em tons de cinza do
// quadro da câmera (~120 px de largura): rápido o bastante para rodar várias vezes
// por segundo no celular.

/**
 * Quadro RGBA → tons de cinza reduzido para `outW` de largura (média dos pixels).
 * @param {Uint8ClampedArray} rgba
 * @param {number} w
 * @param {number} h
 * @param {number} outW
 * @returns {{ data: Float32Array, w: number, h: number }}
 */
export function toGray(rgba, w, h, outW = 120) {
  const scale = w / outW;
  const ow = Math.max(1, Math.round(w / scale));
  const oh = Math.max(1, Math.round(h / scale));
  const data = new Float32Array(ow * oh);
  const count = new Float32Array(ow * oh);
  for (let y = 0; y < h; y++) {
    const oy = Math.min(oh - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const ox = Math.min(ow - 1, Math.floor(x / scale));
      const i = (y * w + x) * 4;
      data[oy * ow + ox] +=
        0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      count[oy * ow + ox] += 1;
    }
  }
  for (let i = 0; i < data.length; i++) data[i] /= count[i] || 1;
  return { data, w: ow, h: oh };
}

/**
 * Nitidez: média do valor absoluto do laplaciano (bordas fortes = texto nítido).
 * Foto tremida ou fora de foco dá número baixo.
 * @param {{ data: Float32Array, w: number, h: number }} g
 */
export function sharpness(g) {
  let sum = 0;
  let n = 0;
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const i = y * g.w + x;
      const lap =
        4 * g.data[i] -
        g.data[i - 1] -
        g.data[i + 1] -
        g.data[i - g.w] -
        g.data[i + g.w];
      sum += Math.abs(lap);
      n++;
    }
  }
  return n ? sum / n : 0;
}

/**
 * Movimento: diferença média entre dois quadros (0–255). Câmera parada ≈ 0–3.
 * @param {{ data: Float32Array }} a
 * @param {{ data: Float32Array }} b
 */
export function motion(a, b) {
  if (a.data.length !== b.data.length) return 255;
  let sum = 0;
  for (let i = 0; i < a.data.length; i++)
    sum += Math.abs(a.data[i] - b.data[i]);
  return sum / a.data.length;
}

/** Correlação normalizada entre a faixa `rows` de `a` (a partir de ay) e de `b` (by). */
function ncc(a, ay, b, by, rows) {
  const n = rows * a.w;
  let ma = 0;
  let mb = 0;
  for (let k = 0; k < n; k++) {
    ma += a.data[ay * a.w + k];
    mb += b.data[by * b.w + k];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let k = 0; k < n; k++) {
    const va = a.data[ay * a.w + k] - ma;
    const vb = b.data[by * b.w + k] - mb;
    num += va * vb;
    da += va * va;
    db += vb * vb;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** Faixa do trecho anterior que deve reaparecer no topo do próximo (fração da altura). */
export const STRIP = { from: 0.72, to: 0.92 };

/**
 * Onde a faixa de baixo do trecho anterior aparece no quadro atual: procura nas
 * posições do topo até a metade. `offset` (fração da altura) perto de 0 = a pessoa
 * desceu o bastante; `score` (−1 a 1) = quanto a faixa bate.
 * @param {{ data: Float32Array, w: number, h: number }} prev
 * @param {{ data: Float32Array, w: number, h: number }} cur
 */
export function findOverlap(prev, cur) {
  if (prev.w !== cur.w) return { offset: 1, score: 0 };
  const from = Math.floor(prev.h * STRIP.from);
  const rows = Math.max(4, Math.floor(prev.h * STRIP.to) - from);
  const maxY = Math.min(cur.h - rows, Math.floor(cur.h * 0.6));
  let best = { offset: 1, score: -1 };
  for (let y = 0; y <= maxY; y++) {
    const score = ncc(prev, from, cur, y, rows);
    if (score > best.score) best = { offset: y / cur.h, score };
  }
  return best;
}

/** Limites da decisão (ajustáveis com o ?debug=1 da tela). */
export const LIMITS = {
  steadyMotion: 4, // abaixo disso a câmera está parada
  steadyMs: 450, // parada por esse tempo
  minSharpness: 3, // abaixo disso está borrado
  sharpOfBest: 0.7, // pelo menos 70% da melhor nitidez recente
  // Nota fiscal tem linhas parecidas em intervalos regulares: a faixa "bate" em
  // lugares errados com ~0,55–0,60 (medido em notas simuladas). Encaixe de verdade
  // fica bem acima disso.
  goodOverlap: 0.72, // a faixa bate
  lostOverlap: 0.66, // abaixo disso, a faixa não está mais na tela
  readyOffset: 0.2, // faixa no topo: desceu o bastante
};

/**
 * O que fazer agora.
 * @param {{ steadyFor: number, sharp: number, bestSharp: number,
 *           overlap: { offset: number, score: number } | null }} s
 * @returns {"capture" | "hold" | "blurry" | "down" | "back"}
 */
export function decide(s, limits = LIMITS) {
  if (s.overlap) {
    if (s.overlap.score < limits.lostOverlap) return "back";
    if (
      s.overlap.score < limits.goodOverlap ||
      s.overlap.offset > limits.readyOffset
    )
      return "down";
  }
  if (s.steadyFor < limits.steadyMs) return "hold";
  if (
    s.sharp < limits.minSharpness ||
    s.sharp < s.bestSharp * limits.sharpOfBest
  )
    return "blurry";
  return "capture";
}

// Tipos do scan-core.js (usado no navegador e nos testes).
export interface Gray {
  data: Float32Array;
  w: number;
  h: number;
}
export function toGray(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  outW?: number,
): Gray;
export function sharpness(g: Gray): number;
export function motion(a: Gray, b: Gray): number;
export const STRIP: { from: number; to: number };
export function findOverlap(
  prev: Gray,
  cur: Gray,
): { offset: number; score: number };
export const LIMITS: Record<
  | "steadyMotion"
  | "steadyMs"
  | "minSharpness"
  | "sharpOfBest"
  | "goodOverlap"
  | "lostOverlap"
  | "readyOffset",
  number
>;
export function decide(
  s: {
    steadyFor: number;
    sharp: number;
    bestSharp: number;
    overlap: { offset: number; score: number } | null;
  },
  limits?: typeof LIMITS,
): "capture" | "hold" | "blurry" | "down" | "back";

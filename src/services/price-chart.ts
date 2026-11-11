import type { PricePoint, PriceUnit } from "../db/prices-repo.js";

// Gráfico do preço de um produto ao longo do tempo, desenhado no servidor (SVG na
// view, sem biblioteca). Função pura: compras → coordenadas, eixos, cores e números.

// Cores dos mercados (distintas entre si e legíveis no claro e no escuro).
const PALETTE = [
  "#2563eb",
  "#e11d48",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#65a30d",
];
const OTHER = "#6b7280"; // a partir do 9º mercado

export const CHART = {
  width: 640,
  height: 260,
  left: 64,
  right: 16,
  top: 16,
  bottom: 32,
};

export interface StoreSeries {
  key: string;
  /** linha ligando as compras deste mercado em ordem de data */
  path: string;
  name: string;
  cnpj: string | null;
  color: string;
  count: number;
  minCents: number;
  avgCents: number;
  lastCents: number;
}

export interface ChartPoint extends PricePoint {
  x: number;
  y: number;
  color: string;
  mine: boolean;
}

export interface PriceChart {
  /** unidade do gráfico: a mais comum entre as compras */
  unit: PriceUnit;
  /** compras em outra unidade (só na tabela) */
  otherUnit: number;
  points: ChartPoint[];
  xTicks: { x: number; label: string; anchor: "start" | "middle" | "end" }[];
  yTicks: { y: number; cents: number }[];
  stores: StoreSeries[];
  stats: {
    count: number;
    lastCents: number;
    minCents: number;
    maxCents: number;
    avgCents: number;
    users: number;
  };
}

const DAY = 86_400_000;
const MONTHS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/** Passo "redondo" (1, 2, 2,5 ou 5 × 10ⁿ centavos) para ~4 marcas no eixo. */
export function niceStep(range: number, ticks = 4): number {
  const raw = Math.max(range, 1) / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  return step ?? 10 * pow;
}

const avg = (xs: number[]) =>
  Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

export function priceChart(all: PricePoint[], meId: number): PriceChart | null {
  if (all.length === 0) return null;
  const kg = all.filter((p) => p.unit === "kg").length;
  const unit: PriceUnit = kg > all.length - kg ? "kg" : "un";
  const pts = all.filter((p) => p.unit === unit);

  // Eixo X: datas. Uma data só (ou todas iguais): meia-janela de 15 dias de cada lado.
  const time = (d: string) => Date.parse(`${d}T12:00:00Z`);
  let t0 = Math.min(...pts.map((p) => time(p.purchase_date)));
  let t1 = Math.max(...pts.map((p) => time(p.purchase_date)));
  if (t1 - t0 < DAY) {
    t0 -= 15 * DAY;
    t1 += 15 * DAY;
  }
  // Eixo Y: preço, com folga e marcas redondas; começa num múltiplo do passo.
  const prices = pts.map((p) => p.unit_price_cents);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const step = niceStep(hi - lo || hi);
  const y0 = Math.max(0, Math.floor((lo - step / 2) / step) * step);
  const y1 = Math.ceil((hi + step / 2) / step) * step;

  const { width, height, left, right, top, bottom } = CHART;
  const sx = (t: number) =>
    left + ((t - t0) / (t1 - t0)) * (width - left - right);
  const sy = (c: number) =>
    top + (1 - (c - y0) / (y1 - y0)) * (height - top - bottom);

  // Mercados na ordem em que aparecem; cada um com sua cor.
  const stores = new Map<string, StoreSeries & { prices: number[] }>();
  for (const p of pts) {
    const key = p.store_cnpj ?? p.store_name;
    let s = stores.get(key);
    if (!s) {
      s = {
        key,
        name: p.store_name,
        cnpj: p.store_cnpj,
        color: PALETTE[stores.size] ?? OTHER,
        path: "",
        count: 0,
        minCents: 0,
        avgCents: 0,
        lastCents: 0,
        prices: [],
      };
      stores.set(key, s);
    }
    s.prices.push(p.unit_price_cents);
  }

  const points: ChartPoint[] = pts.map((p) => ({
    ...p,
    x: Math.round(sx(time(p.purchase_date)) * 10) / 10,
    y: Math.round(sy(p.unit_price_cents) * 10) / 10,
    color: stores.get(p.store_cnpj ?? p.store_name)?.color ?? OTHER,
    mine: p.user_id === meId,
  }));

  // Marcas do eixo X: 5 datas espaçadas; "mmm/aa", ou "dd/mm" se for um ano só.
  const sameYear =
    new Date(t0).getUTCFullYear() === new Date(t1).getUTCFullYear();
  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / 4;
    const d = new Date(t);
    const label = sameYear
      ? `${String(d.getUTCDate()).padStart(2, "0")}/${MONTHS[d.getUTCMonth()]}`
      : `${MONTHS[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
    // Primeira e última alinhadas para dentro: não cortam na borda.
    const anchor = i === 0 ? "start" : i === 4 ? "end" : "middle";
    return { x: Math.round(sx(t)), label, anchor } as const;
  });
  const yTicks: { y: number; cents: number }[] = [];
  for (let c = y0; c <= y1 + 1e-9; c += step)
    yTicks.push({ y: Math.round(sy(c) * 10) / 10, cents: Math.round(c) });

  return {
    unit,
    otherUnit: all.length - pts.length,
    points,
    xTicks,
    yTicks,
    // Uma linha por mercado: ligar compras de lojas diferentes fingiria uma
    // oscilação que é só diferença de preço entre lojas.
    stores: [...stores.values()].map(({ prices: ps, ...s }) => ({
      ...s,
      path: points
        .filter((p) => (p.store_cnpj ?? p.store_name) === s.key)
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
        .join(" "),
      count: ps.length,
      minCents: Math.min(...ps),
      avgCents: avg(ps),
      lastCents: ps.at(-1) ?? 0,
    })),
    stats: {
      count: pts.length,
      lastCents: prices.at(-1) ?? 0,
      minCents: lo,
      maxCents: hi,
      avgCents: avg(prices),
      users: new Set(pts.map((p) => p.user_id)).size,
    },
  };
}

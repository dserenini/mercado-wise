/**
 * Analytics de preço (Fase 3). Funções puras sobre os itens de compra já
 * normalizados (product_name = conceito, package_size/unit da embalagem).
 *
 * Comparações são sempre feitas em "preço por unidade base" (R$/kg, R$/L, R$/un)
 * e agrupadas por (conceito + unidade base) para comparar sempre igual-com-igual.
 */

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

/** Item mínimo necessário para as análises. Compatível com o achatamento do Insights. */
export interface AnalyticsItem {
  product_name: string;
  unit_price: number;
  quantity: number;
  package_size: number | null;
  package_unit: string | null;
  purchase_date: string;
  supermarket_name: string | null;
}

const unitConversions: Record<string, { base: string; factor: number }> = {
  ml: { base: "L", factor: 0.001 },
  l: { base: "L", factor: 1 },
  g: { base: "kg", factor: 0.001 },
  kg: { base: "kg", factor: 1 },
  un: { base: "un", factor: 1 },
};

/** Preço por unidade base (R$/kg, R$/L...) a partir de tamanho/unidade da embalagem. */
export function pricePerBaseUnit(
  price: number,
  size: number | null,
  unit: string | null,
): { value: number; unit: string } | null {
  if (!size || size <= 0) return null;
  const normalized = (unit || "un").toLowerCase();
  const conv = unitConversions[normalized];
  if (!conv) return { value: price / size, unit: unit || "un" };
  return { value: price / (size * conv.factor), unit: conv.base };
}

/**
 * Valor comparável de um item: preço por unidade base quando há embalagem;
 * senão o próprio preço unitário (itens contáveis sem tamanho). Sempre definido.
 */
export function comparableValue(item: AnalyticsItem): { value: number; unit: string } {
  const p = pricePerBaseUnit(item.unit_price, item.package_size, item.package_unit);
  return p ?? { value: item.unit_price, unit: "un" };
}

/** Chave de conceito para agrupar o mesmo produto (nome já normalizado no backend). */
export const conceptKey = (name: string) => name.trim().toLowerCase();

/** Nomes de conceito distintos presentes nos itens (para seleção manual no scan). */
export function distinctConcepts(items: AnalyticsItem[]): string[] {
  const map = new Map<string, string>();
  for (const it of items) {
    const k = conceptKey(it.product_name);
    if (k && !map.has(k)) map.set(k, it.product_name);
  }
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
}

/** Palpite de qual conceito do histórico corresponde a um nome resolvido (Open Food Facts). */
export function guessConcept(resolvedName: string, concepts: string[]): string | null {
  const tokens = new Set(
    resolvedName.toLowerCase().split(/\s+/).filter((t) => t.length >= 3),
  );
  if (tokens.size === 0) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const c of concepts) {
    let score = 0;
    for (const t of c.toLowerCase().split(/\s+/)) if (tokens.has(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Chave de bucket: conceito + unidade base — compara sempre R$/kg com R$/kg. */
const bucketKey = (name: string, unit: string) => `${conceptKey(name)}||${unit}`;

// ── Média móvel ponderada por recência ──────────────────────────────
// Peso decai pela metade a cada HALF_LIFE_DAYS: observações recentes pesam mais,
// aproximando uma janela de ~90 dias sem descartar o histórico abruptamente.
const HALF_LIFE_DAYS = 60;

function recencyWeight(dateStr: string, now: number): number {
  const ageDays = (now - new Date(dateStr).getTime()) / 86_400_000;
  return Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS);
}

interface Obs {
  value: number;
  date: string;
  market: string | null;
}

function weightedAvg(obs: Obs[], now: number): number {
  let ws = 0;
  let wv = 0;
  for (const o of obs) {
    const w = recencyWeight(o.date, now);
    ws += w;
    wv += w * o.value;
  }
  return ws > 0 ? wv / ws : 0;
}

// ── 3.2 — Benchmarks por conceito (base da média móvel / termômetro) ──

export interface Benchmark {
  concept: string;
  displayName: string;
  unit: string;
  avg: number;
  count: number;
}

function groupObs(items: AnalyticsItem[]): Map<string, { displayName: string; unit: string; obs: Obs[] }> {
  const map = new Map<string, { displayName: string; unit: string; obs: Obs[] }>();
  for (const it of items) {
    if (!it.unit_price || it.unit_price <= 0) continue;
    const { value, unit } = comparableValue(it);
    const key = bucketKey(it.product_name, unit);
    let entry = map.get(key);
    if (!entry) {
      entry = { displayName: it.product_name, unit, obs: [] };
      map.set(key, entry);
    }
    entry.obs.push({ value, date: it.purchase_date, market: it.supermarket_name });
  }
  return map;
}

/** Média móvel ponderada por conceito+unidade. Chave = bucketKey. */
export function computeBenchmarks(items: AnalyticsItem[]): Map<string, Benchmark> {
  const now = Date.now();
  const grouped = groupObs(items);
  const result = new Map<string, Benchmark>();
  grouped.forEach((entry, key) => {
    result.set(key, {
      concept: key,
      displayName: entry.displayName,
      unit: entry.unit,
      avg: weightedAvg(entry.obs, now),
      count: entry.obs.length,
    });
  });
  return result;
}

export type PriceVerdict = "below" | "average" | "above" | "unknown";

/** Compara o valor de um item com a média móvel do seu conceito. */
export function priceVerdict(
  item: AnalyticsItem,
  benchmarks: Map<string, Benchmark>,
): { verdict: PriceVerdict; deltaPct: number; avg: number; unit: string } {
  const { value, unit } = comparableValue(item);
  const bench = benchmarks.get(bucketKey(item.product_name, unit));
  if (!bench || bench.count < 2 || bench.avg <= 0) {
    return { verdict: "unknown", deltaPct: 0, avg: 0, unit };
  }
  const deltaPct = ((value - bench.avg) / bench.avg) * 100;
  let verdict: PriceVerdict = "average";
  if (deltaPct <= -5) verdict = "below";
  else if (deltaPct >= 5) verdict = "above";
  return { verdict, deltaPct, avg: bench.avg, unit };
}

// ── 3.1 — Comparação do mesmo produto entre mercados ─────────────────

export interface MarketPrice {
  market: string;
  value: number;
  date: string;
}

export interface ProductComparison {
  key: string;
  displayName: string;
  unit: string;
  markets: MarketPrice[]; // ordenados do mais barato ao mais caro
}

/** Para cada conceito visto em ≥2 mercados, o preço mais recente por mercado. */
export function computeProductMarketComparisons(items: AnalyticsItem[]): ProductComparison[] {
  const grouped = groupObs(items);
  const result: ProductComparison[] = [];

  grouped.forEach((entry, key) => {
    // Observação mais recente por mercado
    const latestByMarket = new Map<string, MarketPrice>();
    for (const o of entry.obs) {
      if (!o.market) continue;
      const cur = latestByMarket.get(o.market);
      if (!cur || o.date > cur.date) {
        latestByMarket.set(o.market, { market: o.market, value: o.value, date: o.date });
      }
    }
    if (latestByMarket.size >= 2) {
      const markets = Array.from(latestByMarket.values()).sort((a, b) => a.value - b.value);
      result.push({ key, displayName: entry.displayName, unit: entry.unit, markets });
    }
  });

  return result.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ── 3.3 — Ranking de mercados pelo SEU cesto ─────────────────────────

export interface MarketRank {
  market: string;
  index: number; // 1 = na sua média; <1 mais barato; >1 mais caro
  coverage: number; // nº de conceitos do seu cesto observados nesse mercado
}

const MIN_COVERAGE = 3;

// ── Fase 5 — Lista inteligente ───────────────────────────────────────
// Aqui o preço relevante é o PREÇO POR LINHA (o que custa comprar 1 do item,
// como ele é vendido), não o preço por unidade base. Ex.: "1 arroz ≈ R$25".

export interface UnitPriceStat {
  concept: string;
  displayName: string;
  avg: number; // média móvel do preço unitário (por linha)
  count: number;
  lastDate: string;
  byMarket: Map<string, { value: number; date: string }>; // preço mais recente por mercado
}

/** Estatística de preço por linha, por conceito (base das estimativas da lista). */
export function computeUnitPriceStats(items: AnalyticsItem[]): Map<string, UnitPriceStat> {
  const now = Date.now();
  const grouped = new Map<string, { displayName: string; obs: Obs[] }>();
  for (const it of items) {
    if (!it.unit_price || it.unit_price <= 0) continue;
    const k = conceptKey(it.product_name);
    let e = grouped.get(k);
    if (!e) {
      e = { displayName: it.product_name, obs: [] };
      grouped.set(k, e);
    }
    e.obs.push({ value: it.unit_price, date: it.purchase_date, market: it.supermarket_name });
  }

  const result = new Map<string, UnitPriceStat>();
  grouped.forEach((e, k) => {
    const byMarket = new Map<string, { value: number; date: string }>();
    let lastDate = "";
    for (const o of e.obs) {
      if (o.date > lastDate) lastDate = o.date;
      if (o.market) {
        const cur = byMarket.get(o.market);
        if (!cur || o.date > cur.date) byMarket.set(o.market, { value: o.value, date: o.date });
      }
    }
    result.set(k, {
      concept: k,
      displayName: e.displayName,
      avg: weightedAvg(e.obs, now),
      count: e.obs.length,
      lastDate,
      byMarket,
    });
  });
  return result;
}

/** Casa um nome (digitado na lista) com um conceito conhecido: exato, senão palpite. */
export function matchConcept(
  name: string,
  stats: Map<string, UnitPriceStat>,
): UnitPriceStat | null {
  const direct = stats.get(conceptKey(name));
  if (direct) return direct;
  const guess = guessConcept(name, Array.from(stats.values()).map((s) => s.displayName));
  return guess ? stats.get(conceptKey(guess)) ?? null : null;
}

export interface BasketLine {
  id: string;
  name: string;
  quantity: number;
  estimate: number | null;
}

export interface BasketEstimate {
  total: number;
  matchedCount: number;
  totalItems: number;
  lines: BasketLine[];
}

interface ListLike {
  id: string;
  product_name: string;
  quantity: number | null;
}

/** 5.1 — Estimativa da lista pela média geral de cada conceito. */
export function estimateBasket(
  listItems: ListLike[],
  stats: Map<string, UnitPriceStat>,
): BasketEstimate {
  let total = 0;
  let matched = 0;
  const lines: BasketLine[] = listItems.map((li) => {
    const qty = li.quantity || 1;
    const stat = matchConcept(li.product_name, stats);
    const estimate = stat && stat.avg > 0 ? stat.avg * qty : null;
    if (estimate != null) {
      total += estimate;
      matched += 1;
    }
    return { id: li.id, name: li.product_name, quantity: qty, estimate };
  });
  return { total, matchedCount: matched, totalItems: listItems.length, lines };
}

export interface MarketSim {
  market: string;
  total: number;
  matchedCount: number;
  totalItems: number;
  coverage: number;
  oldestDate: string | null;
}

/** 5.2 — Simulação da lista por mercado (preço mais recente de cada item no mercado). */
export function simulateBasketByMarket(
  listItems: ListLike[],
  stats: Map<string, UnitPriceStat>,
  minCoverage = 0.5,
): MarketSim[] {
  const markets = new Set<string>();
  stats.forEach((s) => s.byMarket.forEach((_v, m) => markets.add(m)));
  const totalItems = listItems.length;
  if (totalItems === 0) return [];

  const sims: MarketSim[] = [];
  markets.forEach((market) => {
    let total = 0;
    let matched = 0;
    let oldest: string | null = null;
    for (const li of listItems) {
      const mp = matchConcept(li.product_name, stats)?.byMarket.get(market);
      if (mp) {
        total += mp.value * (li.quantity || 1);
        matched += 1;
        if (!oldest || mp.date < oldest) oldest = mp.date;
      }
    }
    const coverage = matched / totalItems;
    if (coverage >= minCoverage) {
      sims.push({ market, total, matchedCount: matched, totalItems, coverage, oldestDate: oldest });
    }
  });
  return sims.sort((a, b) => a.total - b.total);
}

export interface RepurchaseSuggestion {
  concept: string;
  displayName: string;
  lastDate: string;
  avgIntervalDays: number;
  overdueDays: number;
}

/** 5.3 — Conceitos "provavelmente acabando" pelo ciclo médio de recompra. */
export function computeRepurchaseSuggestions(purchaseItems: AnalyticsItem[]): RepurchaseSuggestion[] {
  const now = Date.now();
  const byConcept = new Map<string, { displayName: string; dates: Set<string> }>();
  for (const it of purchaseItems) {
    const k = conceptKey(it.product_name);
    let e = byConcept.get(k);
    if (!e) {
      e = { displayName: it.product_name, dates: new Set() };
      byConcept.set(k, e);
    }
    e.dates.add(it.purchase_date.slice(0, 10));
  }

  const out: RepurchaseSuggestion[] = [];
  byConcept.forEach((e, k) => {
    const dates = Array.from(e.dates).sort();
    if (dates.length < 2) return;
    let sum = 0;
    for (let i = 1; i < dates.length; i++) {
      sum += (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86_400_000;
    }
    const avgInterval = sum / (dates.length - 1);
    if (avgInterval <= 0) return;
    const last = dates[dates.length - 1];
    const daysSince = (now - new Date(last).getTime()) / 86_400_000;
    const overdue = daysSince - avgInterval;
    if (overdue >= 0) {
      out.push({
        concept: k,
        displayName: e.displayName,
        lastDate: last,
        avgIntervalDays: avgInterval,
        overdueDays: overdue,
      });
    }
  });
  return out.sort((a, b) => b.overdueDays - a.overdueDays);
}

/**
 * Ranqueia mercados pelo custo-benefício do padrão de consumo do usuário.
 * Para cada conceito, compara o preço do mercado com a média geral do usuário
 * (preço relativo), ponderando pela frequência com que o conceito é comprado.
 */
export function computeMarketRanking(items: AnalyticsItem[]): MarketRank[] {
  const now = Date.now();
  const benchmarks = computeBenchmarks(items);

  // Observações por mercado, agrupadas por bucket
  const byMarket = new Map<string, Map<string, Obs[]>>();
  for (const it of items) {
    if (!it.supermarket_name || !it.unit_price || it.unit_price <= 0) continue;
    const { value, unit } = comparableValue(it);
    const key = bucketKey(it.product_name, unit);
    let buckets = byMarket.get(it.supermarket_name);
    if (!buckets) {
      buckets = new Map();
      byMarket.set(it.supermarket_name, buckets);
    }
    const arr = buckets.get(key) ?? [];
    arr.push({ value, date: it.purchase_date, market: it.supermarket_name });
    buckets.set(key, arr);
  }

  const ranks: MarketRank[] = [];
  byMarket.forEach((buckets, market) => {
    let ws = 0;
    let wRel = 0;
    let coverage = 0;
    buckets.forEach((obs, key) => {
      const bench = benchmarks.get(key);
      if (!bench || bench.count < 2 || bench.avg <= 0) return;
      const marketAvg = weightedAvg(obs, now);
      if (marketAvg <= 0) return;
      const weight = bench.count; // conceitos mais comprados pesam mais
      ws += weight;
      wRel += weight * (marketAvg / bench.avg);
      coverage += 1;
    });
    if (coverage >= MIN_COVERAGE && ws > 0) {
      ranks.push({ market, index: wRel / ws, coverage });
    }
  });

  return ranks.sort((a, b) => a.index - b.index);
}

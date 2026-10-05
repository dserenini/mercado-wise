import type {
  ListFilter,
  ListOrder,
  ReceiptSummary,
} from "../db/receipts-repo.js";
import { parseDecimal, toCents } from "../lib/money.js";

// Filtros da lista de notas, vindos da URL (?status=…&de=…&data_de=…). Função pura:
// valor inválido é ignorado (vira "sem filtro"), nunca erro.
//
// Valor: só "de" = aquele valor; "de" e "até" = faixa. Número inteiro vale o real
// inteiro ("66" = R$ 66,00 a R$ 66,99); com centavos, o centavo exato.
// Data: "2026", "2026-08" ou "2026-08-23". Só "de" = aquele ano/mês/dia; com "até",
// do início do primeiro ao fim do segundo.
// Ordem: data (novas/antigas/nenhuma) e valor (caras/baratas); com as duas, os meses
// ficam agrupados e o valor ordena dentro de cada mês.

/** O que a tela mostra de volta nos campos (texto como digitado). */
export interface ListFilterForm {
  status: string;
  de: string;
  ate: string;
  data_de: string;
  data_ate: string;
  ordem_data: string;
  ordem_valor: string;
}

/** Valores padrão, omitidos da URL. */
const DEFAULTS: Partial<ListFilterForm> = {
  ordem_data: "novas",
  ordem_valor: "",
};

const DATE_ORDER = { novas: "desc", antigas: "asc", nenhuma: null } as const;
const VALUE_ORDER = { caras: "desc", baratas: "asc" } as const;

/** Faixa em centavos que um valor digitado cobre (inteiro = o real inteiro). */
export function valueBounds(text: string): [number, number] | null {
  const value = parseDecimal(text);
  if (value === null || Number.isNaN(value) || value < 0) return null;
  const cents = toCents(value);
  const whole = /^\s*(R\$\s*)?\d+\s*$/.test(text);
  return whole ? [cents, cents + 99] : [cents, cents];
}

/** Primeiro e último dia (AAAA-MM-DD) que um ano, mês ou dia cobre. */
export function dateBounds(text: string): [string, string] | null {
  const m = text.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  if (year < 2000 || year > 2100) return null;
  if (mo === undefined) return [`${y}-01-01`, `${y}-12-31`];
  const month = Number(mo);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (d === undefined) return [`${y}-${mo}-01`, `${y}-${mo}-${lastDay}`];
  return Number(d) >= 1 && Number(d) <= lastDay ? [text, text] : null;
}

export function parseListFilter(query: Record<string, unknown>): {
  filter: ListFilter;
  form: ListFilterForm;
  active: number;
} {
  const text = (key: string) => {
    const value = query[key];
    return typeof value === "string" ? value.trim() : "";
  };

  const de = valueBounds(text("de"));
  const ate = valueBounds(text("ate"));
  const dataDe = dateBounds(text("data_de"));
  const dataAte = dateBounds(text("data_ate"));
  const status = text("status");
  const ordemData = Object.hasOwn(DATE_ORDER, text("ordem_data"))
    ? (text("ordem_data") as keyof typeof DATE_ORDER)
    : "novas";
  const ordemValor = Object.hasOwn(VALUE_ORDER, text("ordem_valor"))
    ? (text("ordem_valor") as keyof typeof VALUE_ORDER)
    : null;
  const order: ListOrder = {
    date: DATE_ORDER[ordemData],
    value: ordemValor && VALUE_ORDER[ordemValor],
  };

  const filter: ListFilter = {
    status: status === "draft" || status === "confirmed" ? status : null,
    minCents: de?.[0] ?? null,
    maxCents: (ate ?? de)?.[1] ?? null,
    fromDate: dataDe?.[0] ?? null,
    toDate: (dataAte ?? dataDe)?.[1] ?? null,
    order,
  };
  const form: ListFilterForm = {
    status: filter.status ?? "",
    de: de ? text("de") : "",
    ate: ate ? text("ate") : "",
    data_de: dataDe ? text("data_de") : "",
    data_ate: dataAte ? text("data_ate") : "",
    ordem_data: ordemData,
    ordem_valor: ordemValor ?? "",
  };
  const active = [filter.status, de ?? ate, dataDe ?? dataAte].filter(
    (v) => v !== null,
  ).length;
  return { filter, form, active };
}

/** Os filtros de volta em query string, só os preenchidos (para voltar à lista). */
export function filterQuery(form: ListFilterForm): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value !== "" && value !== DEFAULTS[key as keyof ListFilterForm])
      params.set(key, value);
  }
  return params.toString();
}

export interface MonthGroup {
  /** "agosto de 2026"; null quando a lista não está agrupada */
  label: string | null;
  totalCents: number;
  receipts: ReceiptSummary[];
}

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** Com ordem por data e valor, separa a lista (já ordenada) em meses. */
export function groupByMonth(
  receipts: ReceiptSummary[],
  order: ListOrder,
): MonthGroup[] {
  const sum = (rs: ReceiptSummary[]) =>
    rs.reduce((acc, r) => acc + (r.total_cents ?? 0), 0);
  if (!order.date || !order.value)
    return [{ label: null, totalCents: sum(receipts), receipts }];
  const groups: MonthGroup[] = [];
  for (const r of receipts) {
    const [y, m] = r.purchase_date?.split("-") ?? [];
    const month = MONTHS[Number(m) - 1] ?? "";
    const label =
      y && m
        ? `${month.charAt(0).toUpperCase()}${month.slice(1)} de ${y}`
        : "Sem data";
    const last = groups.at(-1);
    if (last?.label === label) last.receipts.push(r);
    else groups.push({ label, totalCents: 0, receipts: [r] });
  }
  for (const g of groups) g.totalCents = sum(g.receipts);
  return groups;
}

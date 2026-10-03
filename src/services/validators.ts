import { formatCents, toCents } from "../lib/money.js";
import type { ItemRead, ReceiptRead } from "../schemas/receipt.js";

// Etapa VALIDAR: sem IA. Usa a redundância da própria nota para denunciar leitura
// errada sem precisar de gabarito: dígitos verificadores (EAN, CNPJ, chave de acesso)
// e contas (qtd × preço = total da linha; soma dos itens = total da nota).
// Portado de legacy-v0: backend/app/services/vision/validators.py, com duas mudanças:
// contas em centavos inteiros e tolerância de 1 centavo (o legado aceitava 2% no total,
// o que esconde um item lido errado numa compra grande).

// --------------------------------------------------------------------------
// Dígitos verificadores
// --------------------------------------------------------------------------

/**
 * GTIN-8/12/13/14 (EAN/UPC): pesos 3,1,3,1… a partir do dígito à esquerda do verificador.
 * Aceita de 8 a 14 dígitos porque a nota às vezes omite zeros à esquerda (o UPC
 * "070847022206" sai impresso "70847022206"); zero à esquerda não muda o DV.
 */
export function isValidGtin(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false;
  const digits = [...code.padStart(14, "0")].map(Number);
  const check = digits.pop();
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * EAN atribuído pelo fabricante (vale em qualquer mercado). Códigos que começam com 2
 * são gerados pela balança do próprio mercado, com peso ou preço embutido: mudam a
 * cada etiqueta e não identificam o produto.
 */
export function isManufacturerEan(code: string): boolean {
  if (!isValidGtin(code)) return false;
  return !((code.length === 12 || code.length === 13) && code.startsWith("2"));
}

/** CNPJ: 14 dígitos, os dois últimos são DVs por módulo 11 com pesos 2..9 cíclicos. */
export function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digits = [...cnpj].map(Number);
  const dv = (nums: number[]) => {
    const sum = nums.reduceRight(
      (acc, d, i) => acc + d * (((nums.length - 1 - i) % 8) + 2),
      0,
    );
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return (
    dv(digits.slice(0, 12)) === digits[12] &&
    dv(digits.slice(0, 13)) === digits[13]
  );
}

/** Chave de acesso NF-e/NFC-e: 44 dígitos, o último é DV por módulo 11 (pesos 2..9). */
export function isValidAccessKey(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false;
  const body = [...key.slice(0, 43)].map(Number);
  const sum = body.reduceRight(
    (acc, d, i) => acc + d * (((42 - i) % 8) + 2),
    0,
  );
  const rest = sum % 11;
  const dv = rest < 2 ? 0 : 11 - rest;
  return dv === Number(key[43]);
}

// --------------------------------------------------------------------------
// Resultado
// --------------------------------------------------------------------------

/** ok = conferido; fail = conferido e errado; unknown = faltou dado para conferir. */
export type Check = "ok" | "fail" | "unknown";

/** green = tudo conferido; yellow = revisar com atenção; red = melhor refazer a foto. */
export type TrafficLight = "green" | "yellow" | "red";

export interface Problem {
  severity: "error" | "warning";
  message: string;
}

export interface ItemValidation {
  index: number;
  ean: Check;
  arithmetic: Check;
  /** total ilegível, mas qtd e preço lidos: quanto a conta daria (sugestão para a revisão) */
  suggestedTotalCents: number | null;
  problems: Problem[];
}

export interface ReceiptValidation {
  items: ItemValidation[];
  checks: {
    /** total a pagar = soma dos itens − descontos */
    total: Check;
    /** "Valor total" impresso = soma dos itens (só quando a nota traz os dois totais) */
    grossTotal: Check;
    itemsCount: Check;
    cnpj: Check;
    accessKey: Check;
    /** a chave de acesso contém o CNPJ do emitente (posições 7 a 20) */
    cnpjMatchesKey: Check;
    /** a chave de acesso contém ano/mês da emissão (posições 3 a 6) */
    dateMatchesKey: Check;
  };
  sumItemsCents: number;
  expectedTotalCents: number;
  /** total impresso − total esperado; null se a nota não tem total legível */
  totalDiffCents: number | null;
  /** a diferença do total some quando se usam os totais sugeridos dos itens ilegíveis */
  totalExplainedBySuggestions: boolean;
  problems: Problem[];
  trafficLight: TrafficLight;
}

// --------------------------------------------------------------------------
// Validação
// --------------------------------------------------------------------------

/**
 * Tolerância da conta de cada linha. qtd × preço quase nunca dá centavo exato em item
 * pesado (0,455 kg × 3,98 = 1,8109); a nota trunca ou arredonda, o que dá menos de 1
 * centavo de diferença. Mais que isso é dígito lido errado.
 */
const LINE_TOLERANCE_CENTS = 1;

export function validateItem(item: ItemRead, index: number): ItemValidation {
  const problems: Problem[] = [];
  const error = (message: string) =>
    problems.push({ severity: "error", message });
  const warning = (message: string) =>
    problems.push({ severity: "warning", message });

  let ean: Check = "unknown";
  if (item.ean !== null) {
    ean = isValidGtin(item.ean) ? "ok" : "fail";
    if (ean === "fail")
      error(`EAN ${item.ean} não confere no dígito verificador`);
  } else if (item.store_code === null) {
    warning("Sem código de barras e sem código interno");
  }

  if (item.raw_description === null) warning("Descrição ilegível");

  let arithmetic: Check = "unknown";
  let suggestedTotalCents: number | null = null;
  const { quantity, unit_price, total_price } = item;
  if (
    total_price === null &&
    quantity !== null &&
    unit_price !== null &&
    quantity > 0
  ) {
    suggestedTotalCents = Math.round(quantity * unit_price * 100);
    warning(
      `Total ilegível; pela conta seria ${formatCents(suggestedTotalCents)} ` +
        `(${quantity} × ${formatCents(toCents(unit_price))})`,
    );
  } else if (quantity === null || unit_price === null || total_price === null) {
    warning("Faltou quantidade, preço unitário ou total para conferir a conta");
  } else if (quantity <= 0 || unit_price < 0 || total_price < 0) {
    arithmetic = "fail";
    error("Quantidade ou preço inválido (zero ou negativo)");
  } else {
    const diff = Math.abs(quantity * unit_price * 100 - toCents(total_price));
    arithmetic = diff < LINE_TOLERANCE_CENTS ? "ok" : "fail";
    if (arithmetic === "fail") {
      error(
        `${quantity} × ${formatCents(toCents(unit_price))} não dá ${formatCents(toCents(total_price))}`,
      );
    }
  }

  return { index, ean, arithmetic, suggestedTotalCents, problems };
}

export function validateReceipt(receipt: ReceiptRead): ReceiptValidation {
  const items = receipt.items.map(validateItem);
  const problems: Problem[] = [];
  const error = (message: string) =>
    problems.push({ severity: "error", message });
  const warning = (message: string) =>
    problems.push({ severity: "warning", message });

  // --- Totais (tudo em centavos) ---
  const sumItemsCents = sumCents(receipt.items.map((i) => i.total_price));
  const itemDiscountsCents = sumCents(receipt.items.map((i) => i.discount));
  const discountCents =
    receipt.discount_total !== null
      ? toCents(receipt.discount_total)
      : itemDiscountsCents;
  const expectedTotalCents = sumItemsCents - discountCents;

  const suggested = items.filter((i) => i.suggestedTotalCents !== null);
  const suggestedCents = suggested.reduce(
    (acc, i) => acc + (i.suggestedTotalCents ?? 0),
    0,
  );

  let total: Check = "unknown";
  let totalDiffCents: number | null = null;
  let totalExplainedBySuggestions = false;
  if (receipt.total === null) {
    warning("Total da nota ilegível");
  } else {
    totalDiffCents = toCents(receipt.total) - expectedTotalCents;
    total = totalDiffCents === 0 ? "ok" : "fail";
    // Cada total sugerido pode errar 1 centavo (a nota trunca ou arredonda).
    totalExplainedBySuggestions =
      suggested.length > 0 &&
      Math.abs(totalDiffCents - suggestedCents) <= suggested.length;
    const message =
      `Soma dos itens${discountCents > 0 ? " menos descontos" : ""} dá ` +
      `${formatCents(expectedTotalCents)}, mas a nota diz ${formatCents(toCents(receipt.total))}`;
    if (totalExplainedBySuggestions) {
      const which = suggested.map((i) => i.index + 1).join(", ");
      warning(
        `${message}; com o total sugerido do(s) item(ns) ${which}, a nota fecha`,
      );
    } else if (total === "fail") {
      error(message);
    }
  }

  let grossTotal: Check = "unknown";
  if (receipt.gross_total !== null && discountCents > 0) {
    grossTotal = toCents(receipt.gross_total) === sumItemsCents ? "ok" : "fail";
    if (grossTotal === "fail") {
      error(
        `Soma dos itens dá ${formatCents(sumItemsCents)}, mas o "Valor total" impresso é ` +
          formatCents(toCents(receipt.gross_total)),
      );
    }
  }

  // "Qtd. total de itens" varia por layout: uns contam linhas, outros somam as
  // unidades (item pesado conta 1). Vale qualquer uma das duas.
  let itemsCount: Check = "unknown";
  if (receipt.items_count !== null) {
    const lines = receipt.items.length;
    const units = receipt.items.reduce((acc, i) => acc + unitsOf(i), 0);
    itemsCount =
      receipt.items_count === lines || receipt.items_count === units
        ? "ok"
        : "fail";
    if (itemsCount === "fail") {
      error(
        `A nota diz ${receipt.items_count} itens, mas foram lidas ${lines} linhas (${units} unidades)`,
      );
    }
  }

  // --- Cabeçalho ---
  const { cnpj } = receipt.store;
  const key = receipt.access_key;
  const cnpjCheck: Check =
    cnpj === null ? "unknown" : isValidCnpj(cnpj) ? "ok" : "fail";
  if (cnpjCheck === "fail")
    warning(`CNPJ ${cnpj} não confere no dígito verificador`);
  const keyCheck: Check =
    key === null ? "unknown" : isValidAccessKey(key) ? "ok" : "fail";
  if (keyCheck === "fail")
    warning("Chave de acesso não confere no dígito verificador");

  let cnpjMatchesKey: Check = "unknown";
  if (cnpj !== null && key !== null && key.length === 44) {
    cnpjMatchesKey = key.slice(6, 20) === cnpj ? "ok" : "fail";
    if (cnpjMatchesKey === "fail")
      warning("O CNPJ não bate com o da chave de acesso");
  }

  let dateMatchesKey: Check = "unknown";
  const date = receipt.purchase_date?.match(/^\d{2}(\d{2})-(\d{2})-\d{2}$/);
  if (date && key !== null && key.length === 44) {
    dateMatchesKey = key.slice(2, 6) === `${date[1]}${date[2]}` ? "ok" : "fail";
    if (dateMatchesKey === "fail")
      warning("A data não bate com o ano/mês da chave de acesso");
  }

  if (!receipt.is_receipt) error("A foto não parece ser um cupom fiscal");
  if (receipt.quality.flags.includes("cropped"))
    warning("Parte da nota ficou fora da foto");

  const checks = {
    total,
    grossTotal,
    itemsCount,
    cnpj: cnpjCheck,
    accessKey: keyCheck,
    cnpjMatchesKey,
    dateMatchesKey,
  };

  return {
    items,
    checks,
    sumItemsCents,
    expectedTotalCents,
    totalDiffCents,
    totalExplainedBySuggestions,
    problems,
    trafficLight: trafficLight(
      receipt,
      items,
      checks,
      totalExplainedBySuggestions ? null : totalDiffCents,
    ),
  };
}

const WEIGHT_UNITS = new Set(["kg", "g"]);

function unitsOf(item: ItemRead): number {
  const { quantity, unit } = item;
  if (quantity === null || !Number.isInteger(quantity)) return 1;
  if (unit !== null && WEIGHT_UNITS.has(unit.toLowerCase())) return 1;
  return quantity;
}

/**
 * Semáforo. Toda nota passa pela tela de revisão de qualquer jeito; a cor só diz
 * quanto cuidado a revisão pede.
 */
function trafficLight(
  receipt: ReceiptRead,
  items: ItemValidation[],
  checks: ReceiptValidation["checks"],
  totalDiffCents: number | null,
): TrafficLight {
  const itemErrors = items.filter((i) =>
    i.problems.some((p) => p.severity === "error"),
  ).length;
  const totalCents = receipt.total === null ? null : toCents(receipt.total);

  // Vermelho: não dá para aproveitar a leitura; refazer a foto sai mais barato que corrigir.
  if (!receipt.is_receipt || receipt.items.length === 0) return "red";
  if (itemErrors > 3) return "red";
  if (
    totalDiffCents !== null &&
    totalCents !== null &&
    Math.abs(totalDiffCents) > Math.max(50, totalCents * 0.05)
  ) {
    return "red";
  }

  // Verde: cada item e cada total conferidos, sem nenhum alerta.
  const allItemsClean = items.every(
    (i) => i.problems.length === 0 && i.arithmetic === "ok",
  );
  const noHeaderFailure = Object.values(checks).every((c) => c !== "fail");
  if (allItemsClean && checks.total === "ok" && noHeaderFailure) return "green";

  return "yellow";
}

function sumCents(values: (number | null)[]): number {
  return values.reduce<number>(
    (acc, v) => acc + (v === null ? 0 : toCents(v)),
    0,
  );
}

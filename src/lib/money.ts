// Dinheiro é sempre inteiro em centavos dentro do app: 0.1 + 0.2 !== 0.3 em ponto
// flutuante, mas 10 + 20 === 30. A conversão acontece uma vez, na fronteira.

/** Reais (como lidos da nota) → centavos inteiros. */
export function toCents(reais: number): number {
  return Math.round(reais * 100);
}

/** Centavos → texto em reais para mensagens ("R$ 72,23"). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100).toLocaleString("pt-BR");
  return `${sign}R$ ${reais},${String(abs % 100).padStart(2, "0")}`;
}

// --- Formulários: números no formato brasileiro ---------------------------

/**
 * "1.234,56" / "12,99" / "12.99" / "R$ 5" → número; vazio → null; inválido → NaN.
 * Com vírgula, o ponto é separador de milhar; sem vírgula, o ponto é decimal.
 */
export function parseDecimal(text: string): number | null {
  const clean = text.replace(/R\$|\s/g, "");
  if (clean === "") return null;
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean;
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

/** Texto em reais → centavos; vazio → null; inválido → NaN. */
export function parseCents(text: string): number | null {
  const value = parseDecimal(text);
  return value === null || Number.isNaN(value) ? value : toCents(value);
}

/** Centavos → texto para campo de formulário ("12,99"); null → "". */
export function centsToInput(cents: number | null): string {
  if (cents === null) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Número → texto para campo de formulário ("0,455"); null → "". */
export function decimalToInput(value: number | null): string {
  return value === null ? "" : String(value).replace(".", ",");
}

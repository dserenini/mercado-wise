import { foldText } from "../db/suggest-repo.js";

/**
 * Marca abreviada na nota ("ALBA", "PANT") → marca já confirmada que começa igual
 * ("Albanos", "Pantaneira"). Só quando uma única marca conhecida serve; se nenhuma
 * ou várias servem ("Pira": Piracanjuba ou Piraquê), devolve null. Também null se a
 * marca já é conhecida como está.
 */
export function completeBrand(
  brand: string | null,
  known: readonly string[],
): string | null {
  const short = brand ? foldText(brand) : "";
  if (short.length < 2) return null;
  const matches = new Map<string, string>();
  for (const name of known) {
    const full = foldText(name);
    if (full === short) return null;
    if (full.startsWith(short)) matches.set(full, name);
  }
  return matches.size === 1 ? ([...matches.values()][0] ?? null) : null;
}

/**
 * Marca do Open Food Facts ("CISNE", "Dori, Petitz") → como mostrar: a primeira da
 * lista, com a grafia de uma marca já confirmada quando for a mesma, ou sem o caixa
 * alta.
 */
export function offBrand(
  brands: string | null,
  known: readonly string[],
): string | null {
  const first = brands?.split(",")[0]?.trim();
  if (!first) return null;
  const same = known.find((k) => foldText(k) === foldText(first));
  if (same) return same;
  if (first !== first.toUpperCase()) return first;
  return first
    .toLowerCase()
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());
}

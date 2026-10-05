import { formatCents } from "../lib/money.js";
import { isValidAccessKey } from "./validators.js";

// Camada 3 da detecção de nota repetida (as camadas 1 e 2 são a foto igual e a chave
// de acesso igual). Compara, na ordem do mais para o menos forte:
//   1. itens   — pelo menos 80% iguais (sobre a nota com mais itens);
//   2. valor   — até 20% de diferença (um item pode ter saído sem valor);
//   3. data, 4. mercado, 5. pagamento — iguais.
// Dado ausente em um dos lados não reprova (não há como comparar), mas itens e valor
// precisam ter sido comparados de verdade: sem eles, "tudo igual" não diz nada.

export const MIN_SAME_ITEMS = 0.8;
export const MAX_VALUE_DIFF = 0.2;

export interface NoteFacts {
  id: number;
  accessKey: string | null;
  cnpj: string | null;
  storeName: string | null;
  date: string | null; // AAAA-MM-DD
  totalCents: number | null;
  payment: string | null;
  /** um por item: EAN, código interno ou descrição normalizada */
  itemKeys: string[];
}

export type Verdict =
  | { duplicate: true; reason: string }
  | { duplicate: false; failed: string };

/** `b` (a nota nova) parece repetir `a` (já cadastrada)? */
export function compareNotes(a: NoteFacts, b: NoteFacts): Verdict {
  const no = (failed: string): Verdict => ({ duplicate: false, failed });
  const why: string[] = [];

  // Chaves válidas e diferentes: notas fiscais diferentes, sem discussão.
  if (
    a.accessKey &&
    b.accessKey &&
    isValidAccessKey(a.accessKey) &&
    isValidAccessKey(b.accessKey) &&
    a.accessKey !== b.accessKey
  )
    return no("chaves de acesso diferentes");

  // 1. Itens
  if (a.itemKeys.length === 0 || b.itemKeys.length === 0)
    return no("sem itens para comparar");
  const same = sameItems(a.itemKeys, b.itemKeys);
  const most = Math.max(a.itemKeys.length, b.itemKeys.length);
  if (same / most < MIN_SAME_ITEMS)
    return no(`só ${same} de ${most} itens iguais`);
  why.push(`${same} de ${most} itens iguais`);

  // 2. Valor
  if (a.totalCents !== null && b.totalCents !== null) {
    const diff =
      Math.abs(a.totalCents - b.totalCents) /
      Math.max(a.totalCents, b.totalCents, 1);
    if (diff > MAX_VALUE_DIFF)
      return no(`valor ${Math.round(diff * 100)}% diferente`);
    why.push(
      diff === 0
        ? "mesmo valor"
        : `valor ${Math.round(diff * 100)}% diferente (${formatCents(a.totalCents)} × ${formatCents(b.totalCents)})`,
    );
  } else why.push("valor sem comparação");

  // 3–5. Data, mercado, pagamento: iguais ou ausentes
  // Mercado: pelo CNPJ quando as duas têm; senão, pelo nome normalizado.
  const byCnpj = a.cnpj !== null && b.cnpj !== null;
  const exact: [string, string | null, string | null][] = [
    ["data", a.date, b.date],
    [
      "mercado",
      byCnpj ? a.cnpj : fold(a.storeName),
      byCnpj ? b.cnpj : fold(b.storeName),
    ],
    ["pagamento", fold(a.payment), fold(b.payment)],
  ];
  for (const [label, x, y] of exact) {
    if (x === null || y === null) why.push(`${label} sem comparação`);
    else if (x !== y) return no(`${label} diferente`);
    else why.push(`mesmo ${label === "data" ? "dia" : label}`);
  }
  return { duplicate: true, reason: why.join(" · ") };
}

/** Quantos itens das duas listas casam (cada um conta uma vez). */
function sameItems(a: string[], b: string[]): number {
  const left = new Map<string, number>();
  for (const k of a) left.set(k, (left.get(k) ?? 0) + 1);
  let same = 0;
  for (const k of b) {
    const n = left.get(k) ?? 0;
    if (n > 0) {
      same++;
      left.set(k, n - 1);
    }
  }
  return same;
}

function fold(text: string | null): string | null {
  if (text === null) return null;
  const folded = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return folded === "" ? null : folded;
}

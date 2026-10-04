import type { Db } from "./client.js";

// Sugestões da tela de revisão (autocompletar). Só leitura; tudo vem do que já foi
// confirmado em outras notas.

export interface ItemSuggestion {
  raw_description: string;
  product: string;
  brand: string | null;
  variant: string | null;
  package_size: number | null;
  package_unit: string | null;
  category: string;
  same_store: boolean;
}

// Minúsculas e sem acento dos dois lados: "acucar" encontra "Açúcar".
const ACCENTED = "áàâãäéèêëíìîïóòôõöúùûüç";
const PLAIN = "aaaaaeeeeiiiiooooouuuuc";
const fold = (sql: string) =>
  `translate(lower(${sql}), '${ACCENTED}', '${PLAIN}')`;

export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

/**
 * Itens já confirmados cuja descrição na nota, produto, marca ou variante contém o
 * texto. Primeiro os da mesma rede (raiz do CNPJ), depois os que começam com o texto.
 */
export async function suggestItems(
  db: Db,
  text: string,
  storeCnpj: string | null,
  limit = 10,
): Promise<ItemSuggestion[]> {
  const q = foldText(text);
  if (q.length < 2) return [];
  const rows = await db.query<ItemSuggestion>(
    `select a.raw_description, p.product, p.brand, p.variant, p.package_size,
            p.package_unit, p.category, a.store_cnpj_root = $2 as same_store
       from app.product_aliases a join app.products p on p.id = a.product_id
      where position($1 in ${fold("a.raw_description")}) > 0
         or position($1 in ${fold("concat_ws(' ', p.product, p.brand, p.variant)")}) > 0
      order by same_store desc,
               position($1 in ${fold("a.raw_description")}) = 1 desc,
               a.updated_at desc
      limit $3`,
    [q, storeCnpj?.slice(0, 8) ?? "", limit * 2],
  );
  // A mesma descrição pode estar em várias redes apontando para o mesmo produto.
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      const key = [r.raw_description, r.product, r.brand, r.variant].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

/**
 * Nomes de mercado já confirmados, os da mesma rede (raiz do CNPJ) primeiro e depois
 * os mais usados — para o campo Mercado sem erro de digitação.
 */
export async function storeNames(
  db: Db,
  storeCnpj: string | null,
): Promise<string[]> {
  const rows = await db.query<{ store_name: string }>(
    `select store_name
       from app.receipts
      where status = 'confirmed' and store_name is not null
      group by store_name
      order by bool_or(left(store_cnpj, 8) = $1) desc, count(*) desc, store_name
      limit 100`,
    [storeCnpj?.slice(0, 8) ?? ""],
  );
  return rows.map((r) => r.store_name);
}

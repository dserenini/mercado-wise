import type { Db } from "./client.js";
import { fold, foldText } from "./suggest-repo.js";

// Preço dos produtos ao longo do tempo, a partir das notas confirmadas de todos os
// usuários. Só nota confirmada tem o item ligado a um produto (app.products); notas
// repetidas, falhas e rascunhos ficam de fora.

/** Pesado (preço por kg) ou embalado (preço por unidade). */
export type PriceUnit = "kg" | "un";

// Como a nota escreve a unidade ("KG", "kg", "UN", "LT", "BJ"...) → kg ou un.
const UNIT = `case when lower(i.unit) in ('kg', 'g') then 'kg' else 'un' end`;

const CONFIRMED_ITEMS = `app.receipt_items i
  join app.receipts r on r.id = i.receipt_id and r.status = 'confirmed'`;

export interface ProductSummary {
  id: number;
  product: string;
  brand: string | null;
  variant: string | null;
  package_size: number | null;
  package_unit: string | null;
  category: string;
  purchases: number;
  last_purchase: string | null; // AAAA-MM-DD
  last_price_cents: number | null;
  last_unit: PriceUnit | null;
}

const PRODUCT_COLUMNS = `p.id, p.product, p.brand, p.variant, p.package_size,
  p.package_unit, p.category`;

/**
 * Produtos já comprados (em nota confirmada), os mais comprados primeiro. Com texto,
 * só os que o contêm no nome, marca ou variante (sem diferença de acento).
 */
export async function searchProducts(
  db: Db,
  text: string,
  limit = 100,
): Promise<ProductSummary[]> {
  const q = foldText(text);
  return db.query<ProductSummary>(
    `select ${PRODUCT_COLUMNS},
            count(*)::int as purchases,
            max(r.purchase_date)::text as last_purchase,
            (array_agg(i.unit_price_cents order by r.purchase_date desc nulls last, r.id desc))[1]
              as last_price_cents,
            (array_agg(${UNIT} order by r.purchase_date desc nulls last, r.id desc))[1]
              as last_unit
       from ${CONFIRMED_ITEMS}
       join app.products p on p.id = i.product_id
      where $1 = '' or position($1 in ${fold("concat_ws(' ', p.product, p.brand, p.variant)")}) > 0
      group by p.id
      order by count(*) desc, p.product
      limit $2`,
    [q, limit],
  );
}

export async function getProduct(
  db: Db,
  id: number,
): Promise<Omit<
  ProductSummary,
  "purchases" | "last_purchase" | "last_price_cents" | "last_unit"
> | null> {
  const [row] = await db.query<ProductSummary>(
    `select ${PRODUCT_COLUMNS} from app.products p where p.id = $1`,
    [id],
  );
  return row ?? null;
}

export interface PricePoint {
  receipt_id: number;
  purchase_date: string; // AAAA-MM-DD
  store_cnpj: string | null;
  /** nome cadastrado do mercado e o bairro (lojas da mesma rede costumam ter o
   *  mesmo nome); sem cadastro, o nome da nota */
  store_name: string;
  user_id: number;
  owner: string;
  quantity: number | null;
  unit: PriceUnit;
  unit_price_cents: number;
  discount_cents: number | null;
}

/** Cada compra do produto com data e preço unitário, da mais antiga à mais nova. */
export async function productPrices(db: Db, id: number): Promise<PricePoint[]> {
  return db.query<PricePoint>(
    `select r.id as receipt_id, r.purchase_date::text as purchase_date,
            r.store_cnpj,
            coalesce(s.name, r.store_name, 'Mercado não identificado')
              || coalesce(' · ' || s.district, '') as store_name,
            r.user_id, u.username as owner, i.quantity, ${UNIT} as unit,
            i.unit_price_cents, i.discount_cents
       from ${CONFIRMED_ITEMS}
       join app.users u on u.id = r.user_id
       left join app.stores s on s.cnpj = r.store_cnpj
      where i.product_id = $1
        and r.purchase_date is not null and i.unit_price_cents is not null
      order by r.purchase_date, r.id, i.position`,
    [id],
  );
}

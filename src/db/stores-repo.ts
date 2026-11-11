import type { Db } from "./client.js";

// Mercados (app.stores). A loja nasce sozinha no banco quando aparece uma nota com
// CNPJ novo (gatilho da migration 009); aqui só se lê, edita e completa.

export interface Store {
  cnpj: string;
  /** 8 primeiros dígitos do CNPJ: a rede */
  cnpj_root: string;
  name: string;
  legal_name: string | null;
  address: string | null;
  district: string | null;
  postal_code: string | null;
  city: string | null;
  state: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  enriched_at: Date | null;
}

/** Calculado na consulta (nunca guardado): só notas em rascunho ou confirmadas. */
export interface StoreStats {
  receipts: number;
  users: number;
  total_cents: number;
  first_purchase: string | null; // AAAA-MM-DD
  last_purchase: string | null;
}

export type StoreWithStats = Store & StoreStats;

/** Campos que a tela edita (e o preenchimento automático completa). */
export type StoreFields = Pick<
  Store,
  | "name"
  | "legal_name"
  | "address"
  | "district"
  | "postal_code"
  | "city"
  | "state"
  | "country"
  | "latitude"
  | "longitude"
>;

const STORE_COLUMNS = `s.cnpj, s.cnpj_root, s.name, s.legal_name, s.address,
  s.district, s.postal_code, s.city, s.state, s.country, s.latitude, s.longitude,
  s.enriched_at`;

// Notas falhas, lendo ou repetidas não contam: não são compras (ou são cópias).
const STATS = `count(r.id)::int as receipts,
  count(distinct r.user_id)::int as users,
  coalesce(sum(r.total_cents), 0)::int as total_cents,
  min(r.purchase_date)::text as first_purchase,
  max(r.purchase_date)::text as last_purchase`;
const STATS_JOIN = `left join app.receipts r on r.store_cnpj = s.cnpj
  and r.status in ('draft', 'confirmed')`;

export async function listStores(db: Db): Promise<StoreWithStats[]> {
  return db.query<StoreWithStats>(
    `select ${STORE_COLUMNS}, ${STATS}
       from app.stores s ${STATS_JOIN}
      group by s.id
      order by count(r.id) desc, s.name`,
  );
}

export async function getStore(
  db: Db,
  cnpj: string,
): Promise<StoreWithStats | null> {
  const [store] = await db.query<StoreWithStats>(
    `select ${STORE_COLUMNS}, ${STATS}
       from app.stores s ${STATS_JOIN}
      where s.cnpj = $1
      group by s.id`,
    [cnpj],
  );
  return store ?? null;
}

/** Notas da loja (todas, inclusive falhas e repetidas), mais recentes primeiro. */
export async function storeReceipts(db: Db, cnpj: string) {
  return db.query<{
    id: number;
    status: string;
    purchase_date: string | null;
    total_cents: number | null;
    owner: string;
  }>(
    `select r.id, r.status, r.purchase_date::text as purchase_date, r.total_cents,
            u.username as owner
       from app.receipts r join app.users u on u.id = r.user_id
      where r.store_cnpj = $1
      order by r.purchase_date desc nulls last, r.id desc`,
    [cnpj],
  );
}

/** Grava o que a tela mandou (todos os campos). Devolve se a loja existia. */
export async function updateStore(
  db: Db,
  cnpj: string,
  f: StoreFields,
): Promise<boolean> {
  const rows = await db.query(
    `update app.stores set name = $2, legal_name = $3, address = $4, district = $5,
            postal_code = $6, city = $7, state = $8, country = $9, latitude = $10,
            longitude = $11, updated_at = now()
      where cnpj = $1 returning cnpj`,
    [
      cnpj,
      f.name,
      f.legal_name,
      f.address,
      f.district,
      f.postal_code,
      f.city,
      f.state,
      f.country,
      f.latitude,
      f.longitude,
    ],
  );
  return rows.length > 0;
}

/**
 * Completa só os campos vazios (nunca sobrescreve o que alguém editou) e marca a
 * loja como já consultada.
 */
export async function fillStoreBlanks(
  db: Db,
  cnpj: string,
  f: Partial<StoreFields>,
): Promise<void> {
  await db.query(
    `update app.stores set
            legal_name  = coalesce(legal_name, $2),
            address     = coalesce(address, $3),
            district    = coalesce(district, $4),
            postal_code = coalesce(postal_code, $5),
            city        = coalesce(city, $6),
            state       = coalesce(state, $7),
            latitude    = coalesce(latitude, $8),
            longitude   = coalesce(longitude, $9),
            enriched_at = now(), updated_at = now()
      where cnpj = $1`,
    [
      cnpj,
      f.legal_name ?? null,
      f.address ?? null,
      f.district ?? null,
      f.postal_code ?? null,
      f.city ?? null,
      f.state ?? null,
      f.latitude ?? null,
      f.longitude ?? null,
    ],
  );
}

/** Lojas que o preenchimento automático ainda não consultou. */
export async function storesToEnrich(db: Db): Promise<Store[]> {
  return db.query<Store>(
    `select ${STORE_COLUMNS} from app.stores s where s.enriched_at is null order by s.id`,
  );
}

/** A loja da nota, se ela ainda não foi consultada pelo preenchimento automático. */
export async function receiptStoreToEnrich(
  db: Db,
  receiptId: number,
): Promise<Store | null> {
  const [store] = await db.query<Store>(
    `select ${STORE_COLUMNS} from app.stores s
       join app.receipts r on r.store_cnpj = s.cnpj
      where r.id = $1 and s.enriched_at is null`,
    [receiptId],
  );
  return store ?? null;
}

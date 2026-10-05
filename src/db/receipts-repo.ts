import { toCents } from "../lib/money.js";
import type { ItemInterpreted } from "../schemas/interpretation.js";
import type { ReceiptRead } from "../schemas/receipt.js";
import type { PreparedImage } from "../services/image.js";
import type { InterpretedItem } from "../services/interpreter.js";
import type { PipelineResult } from "../services/pipeline.js";
import {
  type ItemValidation,
  isManufacturerEan,
  type Problem,
  problemsStatus,
  type ReceiptValidation,
  validateItem,
} from "../services/validators.js";
import type { Db } from "./client.js";

// Único caminho de escrita das notas no banco. As rotas e scripts chamam estas
// funções; nenhum outro lugar escreve SQL de notas.

export interface CallInfo {
  model: string;
  promptVersion: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  /** resposta crua da IA, para reprocessar e comparar depois */
  payload: unknown;
}

export interface DraftInput {
  receipt: ReceiptRead;
  validation: ReceiptValidation;
  interpreted: (InterpretedItem | null)[];
  calls: { read: CallInfo | null; interpret: CallInfo | null };
  /** foto já preparada (reduzida, JPEG); guardada em app.receipt_images */
  image?: PreparedImage | null;
  source?: "photo" | "legacy";
}

export function draftFromPipeline(result: PipelineResult): DraftInput {
  const { image, read, receipt, validation, interpretation } = result;
  return {
    receipt,
    validation,
    interpreted: interpretation.items,
    image,
    calls: {
      read: { ...read, payload: read.receipt },
      interpret: interpretation.call && {
        ...interpretation.call,
        payload: interpretation.items,
      },
    },
  };
}

/** Grava a nota como rascunho (status 'draft'), já com leitura, validação e interpretação. */
export async function saveDraft(db: Db, input: DraftInput): Promise<number> {
  const { receipt: r, validation, interpreted } = input;
  const cents = (v: number | null) => (v === null ? null : toCents(v));

  return db.transaction(async (tx) => {
    const [row] = await tx.query<{ id: number }>(
      `insert into app.receipts
         (source, store_name, store_cnpj, store_address, access_key, purchase_date,
          purchase_time, items_count, gross_total_cents, discount_total_cents,
          total_cents, payment_method, traffic_light)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning id`,
      [
        input.source ?? "photo",
        r.store.name,
        r.store.cnpj,
        r.store.address,
        r.access_key,
        r.purchase_date,
        r.purchase_time,
        r.items_count,
        cents(r.gross_total),
        cents(r.discount_total),
        cents(r.total),
        r.payment_method,
        validation.trafficLight,
      ],
    );
    if (!row) throw new Error("insert em receipts não devolveu id");

    for (const [position, item] of r.items.entries()) {
      const it = interpreted[position] ?? null;
      const check = validation.items[position];
      await tx.query(
        `insert into app.receipt_items
           (receipt_id, position, raw_description, ean, store_code, quantity, unit,
            unit_price_cents, total_price_cents, discount_cents, product, brand, variant,
            package_size, package_unit, category, confidence, interpretation_source,
            check_status, check_problems)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, $18, $19, $20::text::jsonb)`,
        [
          row.id,
          position,
          item.raw_description,
          item.ean,
          item.store_code,
          item.quantity,
          item.unit,
          cents(item.unit_price),
          cents(item.total_price),
          cents(item.discount),
          it?.product ?? null,
          it?.brand ?? null,
          it?.variant ?? null,
          it?.package_size ?? null,
          it?.package_unit ?? null,
          it?.category ?? null,
          it?.confidence ?? null,
          it?.source ?? null,
          check ? checkStatus(check) : null,
          JSON.stringify(check?.problems ?? []),
        ],
      );
    }

    if (input.image) {
      const { data, mediaType, width, height } = input.image;
      await tx.query(
        `insert into app.receipt_images (receipt_id, media_type, width, height, data)
         values ($1, $2, $3, $4, $5)`,
        [row.id, mediaType, width, height, data],
      );
    }

    for (const [stage, call] of Object.entries(input.calls)) {
      if (!call) continue;
      await tx.query(
        `insert into app.extractions
           (receipt_id, stage, model, prompt_version, payload, input_tokens,
            output_tokens, latency_ms)
         values ($1, $2, $3, $4, $5::text::jsonb, $6, $7, $8)`,
        [
          row.id,
          stage,
          call.model,
          call.promptVersion,
          JSON.stringify(call.payload),
          call.usage.inputTokens,
          call.usage.outputTokens,
          call.latencyMs,
        ],
      );
    }
    return row.id;
  });
}

function checkStatus(check: ItemValidation): "ok" | "warning" | "error" {
  return problemsStatus(check.problems);
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface ReceiptRow {
  id: number;
  status: "draft" | "confirmed";
  source: string;
  store_name: string | null;
  store_cnpj: string | null;
  store_address: string | null;
  access_key: string | null;
  purchase_date: string | null; // AAAA-MM-DD
  purchase_time: string | null; // HH:MM
  items_count: number | null;
  gross_total_cents: number | null;
  discount_total_cents: number | null;
  total_cents: number | null;
  payment_method: string | null;
  has_image: boolean;
  traffic_light: "green" | "yellow" | "red" | null;
  created_at: Date;
  confirmed_at: Date | null;
}

export interface ItemRow {
  id: number;
  position: number;
  raw_description: string | null;
  ean: string | null;
  store_code: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price_cents: number | null;
  total_price_cents: number | null;
  discount_cents: number | null;
  product: string | null;
  brand: string | null;
  variant: string | null;
  package_size: number | null;
  package_unit: string | null;
  category: string | null;
  confidence: string | null;
  interpretation_source: string | null;
  product_id: number | null;
  check_status: "ok" | "warning" | "error" | null;
  check_problems: Problem[];
  edited_by_user: boolean;
  /** só na tela: campos preenchidos pela memória num item de descrição ilegível */
  suggested?: boolean;
}

// date/time viram texto no SELECT para não sofrer conversão de fuso no driver.
const RECEIPT_COLUMNS = `id, status, source, store_name, store_cnpj, store_address,
  access_key, purchase_date::text as purchase_date,
  to_char(purchase_time, 'HH24:MI') as purchase_time, items_count, gross_total_cents,
  discount_total_cents, total_cents, payment_method, traffic_light, created_at,
  confirmed_at,
  exists (select 1 from app.receipt_images i where i.receipt_id = app.receipts.id)
    as has_image`;

export async function getReceipt(
  db: Db,
  id: number,
): Promise<{ receipt: ReceiptRow; items: ItemRow[] } | null> {
  const [receipt] = await db.query<ReceiptRow>(
    `select ${RECEIPT_COLUMNS} from app.receipts where id = $1`,
    [id],
  );
  if (!receipt) return null;
  const items = await db.query<ItemRow>(
    `select id, position, raw_description, ean, store_code, quantity, unit,
            unit_price_cents, total_price_cents, discount_cents, product, brand, variant,
            package_size, package_unit, category, confidence, interpretation_source,
            product_id, check_status, check_problems, edited_by_user
       from app.receipt_items where receipt_id = $1 order by position`,
    [id],
  );
  return { receipt, items };
}

export interface ReceiptSummary {
  id: number;
  status: "draft" | "confirmed";
  store_name: string | null;
  purchase_date: string | null;
  total_cents: number | null;
  traffic_light: "green" | "yellow" | "red" | null;
  item_lines: number;
  created_at: Date;
}

/** Ordem da lista: por data, por valor ou os dois (meses agrupados, valor dentro). */
export interface ListOrder {
  date: "desc" | "asc" | null;
  value: "desc" | "asc" | null;
}

export interface ListFilter {
  status: "draft" | "confirmed" | null;
  /** centavos; com os dois iguais, valor exato */
  minCents: number | null;
  maxCents: number | null;
  /** AAAA-MM-DD, inclusive */
  fromDate: string | null;
  toDate: string | null;
  order: ListOrder;
}

function orderBy({ date, value }: ListOrder): string {
  const byValue = value && `r.total_cents ${value} nulls last`;
  if (date && byValue)
    return `date_trunc('month', r.purchase_date) ${date} nulls last, ${byValue}, r.id`;
  if (byValue) return `${byValue}, r.purchase_date desc nulls last, r.id`;
  const dir = date ?? "desc";
  return `r.purchase_date ${dir} nulls last, r.id ${dir}`;
}

/** Lista de notas com os filtros da página inicial (sem filtro: todas). */
export async function listReceipts(
  db: Db,
  filter: Partial<ListFilter> = {},
): Promise<ReceiptSummary[]> {
  const { where, params } = listWhere(filter);
  return db.query<ReceiptSummary>(
    `select r.id, r.status, r.store_name, r.purchase_date::text as purchase_date,
            r.total_cents, r.traffic_light, r.created_at,
            (select count(*)::int from app.receipt_items i where i.receipt_id = r.id)
              as item_lines
       from app.receipts r
      ${where}
      order by ${orderBy(filter.order ?? { date: "desc", value: null })}`,
    params,
  );
}

/** Limites para os filtros: maior total (barra de valor) e primeiro ano com nota. */
export async function listBounds(
  db: Db,
): Promise<{ maxCents: number; firstYear: number | null }> {
  const [row] = await db.query<{
    max_cents: number | null;
    first_year: number | null;
  }>(
    `select max(total_cents)::int as max_cents,
            extract(year from min(purchase_date))::int as first_year
       from app.receipts`,
  );
  return { maxCents: row?.max_cents ?? 0, firstYear: row?.first_year ?? null };
}

function listWhere(filter: Partial<ListFilter>) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  };
  if (filter.status) add("r.status = ?", filter.status);
  if (filter.minCents != null) add("r.total_cents >= ?", filter.minCents);
  if (filter.maxCents != null) add("r.total_cents <= ?", filter.maxCents);
  if (filter.fromDate) add("r.purchase_date >= ?::date", filter.fromDate);
  if (filter.toDate) add("r.purchase_date <= ?::date", filter.toDate);
  return {
    where: conditions.length > 0 ? `where ${conditions.join(" and ")}` : "",
    params,
  };
}

export async function findReceiptByAccessKey(
  db: Db,
  accessKey: string,
): Promise<{ id: number; status: "draft" | "confirmed" } | null> {
  const [row] = await db.query<{ id: number; status: "draft" | "confirmed" }>(
    "select id, status from app.receipts where access_key = $1",
    [accessKey],
  );
  return row ?? null;
}

export async function getReceiptImage(
  db: Db,
  receiptId: number,
): Promise<{ mediaType: string; data: Uint8Array } | null> {
  const [row] = await db.query<{ media_type: string; data: Uint8Array }>(
    "select media_type, data from app.receipt_images where receipt_id = $1",
    [receiptId],
  );
  return row ? { mediaType: row.media_type, data: row.data } : null;
}

export async function deleteReceipt(db: Db, id: number): Promise<boolean> {
  const rows = await db.query(
    "delete from app.receipts where id = $1 returning id",
    [id],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Confirmação: grava o que o usuário revisou e alimenta a memória
// ---------------------------------------------------------------------------

export interface ConfirmedItem extends ItemInterpreted {
  raw_description: string | null;
  ean: string | null;
  store_code: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price_cents: number | null;
  total_price_cents: number | null;
  discount_cents: number | null;
}

const COMPARED_FIELDS = [
  "raw_description",
  "ean",
  "store_code",
  "quantity",
  "unit",
  "unit_price_cents",
  "total_price_cents",
  "discount_cents",
  "product",
  "brand",
  "variant",
  "package_size",
  "package_unit",
  "category",
] as const;

/** Campos do cabeçalho que a revisão pode corrigir. */
export interface ConfirmedHeader {
  store_name: string | null;
  purchase_date: string | null; // AAAA-MM-DD
  total_cents: number | null;
  payment_method: string | null;
}

/**
 * Substitui os itens do rascunho pela versão revisada (o usuário pode corrigir,
 * incluir e remover itens), marca a nota como confirmada e ensina a memória:
 * cada item vira produto (+ apelido do mercado). Tudo numa transação.
 */
export async function confirmReceipt(
  db: Db,
  id: number,
  items: ConfirmedItem[],
  header?: ConfirmedHeader,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [receipt] = await tx.query<{
      store_cnpj: string | null;
      status: string;
    }>("select store_cnpj, status from app.receipts where id = $1 for update", [
      id,
    ]);
    if (!receipt) throw new Error(`Nota ${id} não existe`);

    const draft = await tx.query<ItemRow>(
      "select * from app.receipt_items where receipt_id = $1",
      [id],
    );
    const draftByPosition = new Map(draft.map((d) => [d.position, d]));
    await tx.query("delete from app.receipt_items where receipt_id = $1", [id]);

    for (const [position, item] of items.entries()) {
      const before = draftByPosition.get(position);
      const edited =
        !before ||
        COMPARED_FIELDS.some((f) => (before[f] ?? null) !== (item[f] ?? null));
      const productId = await rememberItem(
        tx,
        item,
        receipt.store_cnpj,
        "review",
      );
      const reais = (c: number | null) => (c === null ? null : c / 100);
      const check = validateItem(
        {
          ...item,
          unit_price: reais(item.unit_price_cents),
          total_price: reais(item.total_price_cents),
          discount: reais(item.discount_cents),
        },
        position,
      );

      await tx.query(
        `insert into app.receipt_items
           (receipt_id, position, raw_description, ean, store_code, quantity, unit,
            unit_price_cents, total_price_cents, discount_cents, product, brand, variant,
            package_size, package_unit, category, confidence, interpretation_source,
            product_id, check_status, check_problems, edited_by_user)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 $17, $18, $19, $20, $21::text::jsonb, $22)`,
        [
          id,
          position,
          item.raw_description,
          item.ean,
          item.store_code,
          item.quantity,
          item.unit,
          item.unit_price_cents,
          item.total_price_cents,
          item.discount_cents,
          item.product,
          item.brand,
          item.variant,
          item.package_size,
          item.package_unit,
          item.category,
          edited ? "high" : (before?.confidence ?? "high"),
          edited ? "user" : (before?.interpretation_source ?? "user"),
          productId,
          checkStatus(check),
          JSON.stringify(check.problems),
          edited,
        ],
      );
    }

    if (header) {
      await tx.query(
        `update app.receipts set store_name = $2, purchase_date = $3, total_cents = $4,
                payment_method = $5
          where id = $1`,
        [
          id,
          header.store_name,
          header.purchase_date,
          header.total_cents,
          header.payment_method,
        ],
      );
    }
    await tx.query(
      "update app.receipts set status = 'confirmed', confirmed_at = now() where id = $1",
      [id],
    );
  });
}

/**
 * Grava (ou atualiza) o produto e o apelido "como este mercado escreve" na memória.
 * A última confirmação vence: se o usuário corrigir um produto, a correção vale
 * para as próximas notas. Devolve o id do produto.
 */
export async function rememberItem(
  db: Db,
  item: ItemInterpreted & {
    raw_description: string | null;
    ean: string | null;
    store_code: string | null;
  },
  storeCnpj: string | null,
  source: "review" | "ground-truth" | "legacy",
): Promise<number> {
  const ean =
    item.ean !== null && isManufacturerEan(item.ean) ? item.ean : null;
  const fields = [
    item.product,
    item.brand,
    item.variant,
    item.package_size,
    item.package_unit,
    item.category,
    source,
  ];

  const [product] = ean
    ? await db.query<{ id: number }>(
        `insert into app.products
           (product, brand, variant, package_size, package_unit, category, source, ean)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (ean) where ean is not null do update set
           product = excluded.product, brand = excluded.brand, variant = excluded.variant,
           package_size = excluded.package_size, package_unit = excluded.package_unit,
           category = excluded.category, source = excluded.source, updated_at = now()
         returning id`,
        [...fields, ean],
      )
    : await db.query<{ id: number }>(
        `insert into app.products
           (product, brand, variant, package_size, package_unit, category, source)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (product, brand, variant, package_size, package_unit)
           where ean is null do update set
           category = excluded.category, source = excluded.source, updated_at = now()
         returning id`,
        fields,
      );
  if (!product) throw new Error("upsert em products não devolveu id");

  const cnpjRoot = storeCnpj?.slice(0, 8);
  if (cnpjRoot?.length === 8 && item.raw_description) {
    await db.query(
      `insert into app.product_aliases
         (product_id, store_cnpj_root, raw_description, store_code, source)
       values ($1, $2, $3, $4, $5)
       on conflict (store_cnpj_root, description_key) do update set
         raw_description = excluded.raw_description,
         product_id = excluded.product_id,
         store_code = coalesce(excluded.store_code, app.product_aliases.store_code),
         source = excluded.source, updated_at = now()`,
      [product.id, cnpjRoot, item.raw_description, item.store_code, source],
    );
  }
  return product.id;
}

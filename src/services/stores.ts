import type { Db } from "../db/client.js";
import {
  fillStoreBlanks,
  receiptStoreToEnrich,
  type Store,
  type StoreFields,
} from "../db/stores-repo.js";

// Preenchimento automático dos dados do mercado, a partir do CNPJ:
// - BrasilAPI (cadastro público da Receita): razão social, endereço, CEP, cidade, UF;
// - Nominatim (OpenStreetMap): latitude e longitude do endereço.
// Só o CNPJ e o endereço da loja saem do app. Os dois serviços são gratuitos e pedem
// poucas consultas: o Nominatim, no máximo uma por segundo (quem chama em lote espera).

export interface CnpjInfo {
  legal_name: string | null;
  /** "RUA FRANCISCO DESLANDES" */
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  postal_code: string | null;
  city: string | null;
  state: string | null;
}

export interface GeocodeQuery {
  /** "900 Rua Francisco Deslandes"; sem ele, `text` (endereço livre) */
  street?: string;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  text?: string;
}

export interface StoreLookup {
  /** null = falha de rede (tenta outra vez); "not-found" = CNPJ sem cadastro */
  cnpj: (cnpj: string) => Promise<CnpjInfo | "not-found" | null>;
  geocode: (
    q: GeocodeQuery,
  ) => Promise<{ latitude: number; longitude: number } | null>;
}

// Identifica o app, como os dois serviços pedem; sem dado de quem usa.
const USER_AGENT = "mercado-wise (github.com/dserenini/mercado-wise)";

async function getJson(url: string, timeoutMs: number) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}

const text = (v: unknown) =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

export async function fetchCnpj(
  cnpj: string,
  timeoutMs = 8_000,
): Promise<CnpjInfo | "not-found" | null> {
  try {
    const res = await getJson(
      `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
      timeoutMs,
    );
    if (res.status === 404 || res.status === 400) return "not-found";
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, unknown>;
    const street = [text(d.descricao_tipo_de_logradouro), text(d.logradouro)]
      .filter(Boolean)
      .join(" ");
    const cep = text(d.cep)?.replace(/\D/g, "") ?? "";
    return {
      legal_name: text(d.razao_social),
      street: street || null,
      number: text(d.numero),
      complement: text(d.complemento)?.replace(/;+$/, "") ?? null,
      district: text(d.bairro),
      postal_code: /^\d{8}$/.test(cep) ? cep : null,
      city: text(d.municipio),
      state: text(d.uf),
    };
  } catch {
    return null;
  }
}

export async function geocode(
  q: GeocodeQuery,
  timeoutMs = 8_000,
): Promise<{ latitude: number; longitude: number } | null> {
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    countrycodes: "br",
  });
  if (q.street) {
    params.set("street", q.street);
    if (q.city) params.set("city", q.city);
    if (q.state) params.set("state", q.state);
    if (q.postal_code) params.set("postalcode", q.postal_code);
  } else if (q.text) params.set("q", q.text);
  else return null;
  try {
    const res = await getJson(
      `https://nominatim.openstreetmap.org/search?${params}`,
      timeoutMs,
    );
    if (!res.ok) return null;
    const [hit] = (await res.json()) as { lat?: string; lon?: string }[];
    const latitude = Number(hit?.lat);
    const longitude = Number(hit?.lon);
    return Number.isFinite(latitude) && Number.isFinite(longitude) && hit
      ? { latitude, longitude }
      : null;
  } catch {
    return null;
  }
}

export const onlineLookup: StoreLookup = { cnpj: fetchCnpj, geocode };

// "BELO HORIZONTE" → "Belo Horizonte"; "SANTA EFIGENIA DE MINAS" → "Santa Efigenia de Minas"
const SMALL = new Set(["de", "da", "do", "das", "dos", "e"]);
export function titleCase(value: string | null): string | null {
  if (!value) return value;
  return value
    .toLowerCase()
    .split(/(\s+)/)
    .map((w, i) =>
      i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join("");
}

/**
 * Completa os campos vazios da loja pelo CNPJ e pelas coordenadas do endereço.
 * Nunca sobrescreve o que já está preenchido. Devolve false se a consulta do CNPJ
 * falhou por rede (a loja continua "a consultar" e tenta de novo depois).
 */
export async function enrichStore(
  db: Db,
  store: Store,
  lookup: StoreLookup = onlineLookup,
): Promise<boolean> {
  const info = await lookup.cnpj(store.cnpj);
  if (info === null) return false;
  const found = info === "not-found" ? null : info;

  const fields: Partial<StoreFields> = {};
  if (found) {
    fields.legal_name = found.legal_name;
    const address = [
      [titleCase(found.street), found.number].filter(Boolean).join(", "),
      titleCase(found.complement),
    ]
      .filter(Boolean)
      .join(" - ");
    fields.address = address || null;
    fields.district = titleCase(found.district);
    fields.postal_code = found.postal_code;
    fields.city = titleCase(found.city);
    fields.state = found.state;
  }

  if (store.latitude === null || store.longitude === null) {
    const coords = await lookup.geocode(
      found?.street
        ? {
            street: [found.number, titleCase(found.street)]
              .filter(Boolean)
              .join(" "),
            city: found.city,
            state: found.state,
            postal_code: found.postal_code,
          }
        : {
            text: [store.address, store.city, store.state, "Brasil"]
              .filter(Boolean)
              .join(", "),
          },
    );
    if (coords) Object.assign(fields, coords);
  }

  await fillStoreBlanks(db, store.cnpj, fields);
  return true;
}

/**
 * Depois da leitura: completa a loja da nota se ela ainda não foi consultada.
 * Nunca lança (nem com o banco sem a migration 009): a nota já está pronta.
 */
export async function enrichReceiptStore(
  db: Db,
  receiptId: number,
  lookup: StoreLookup,
): Promise<void> {
  try {
    const store = await receiptStoreToEnrich(db, receiptId);
    if (store) await enrichStore(db, store, lookup);
  } catch (error) {
    console.error(error);
  }
}

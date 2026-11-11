// Open Food Facts: base aberta de produtos por código de barras. Consultada em
// segundo plano, depois da leitura, para sugerir a marca de itens que a memória
// ainda não conhece. Só o EAN sai do app. A base limita as consultas por minuto:
// uma por vez, com intervalo, e para ao primeiro "devagar" (429).

export interface OffProduct {
  found: boolean;
  brand: string | null;
  product_name: string | null;
  quantity: string | null;
}

export type OffFetch = (
  ean: string,
) => Promise<OffProduct | "slow-down" | null>;

const BASE = "https://world.openfoodfacts.org/api/v2/product";

/** Uma consulta. null = falha de rede (tenta outro dia); "slow-down" = limite. */
export async function fetchOff(
  ean: string,
  timeoutMs = 5_000,
): Promise<OffProduct | "slow-down" | null> {
  try {
    const res = await fetch(
      `${BASE}/${ean}.json?fields=brands,product_name,quantity`,
      {
        headers: { "User-Agent": "receipt-reader/1.0" },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (res.status === 429) return "slow-down";
    if (res.status === 404)
      return { found: false, brand: null, product_name: null, quantity: null };
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status?: number;
      product?: { brands?: string; product_name?: string; quantity?: string };
    };
    if (body.status !== 1 || !body.product)
      return { found: false, brand: null, product_name: null, quantity: null };
    const text = (v: string | undefined) => v?.trim() || null;
    return {
      found: true,
      brand: text(body.product.brands),
      product_name: text(body.product.product_name),
      quantity: text(body.product.quantity),
    };
  } catch {
    return null;
  }
}

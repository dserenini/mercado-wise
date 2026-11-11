// Nota pelo QR Code. O QR da NFC-e é o endereço da página oficial de consulta na
// SEFAZ do estado, com a chave de acesso no parâmetro `p`. O app NÃO abre essa
// página no servidor (os portais barram acesso automatizado ou pedem captcha): quem
// abre é o navegador da própria pessoa, que copia o conteúdo e cola no app. Aqui só
// se confere o QR e o texto colado.

/** Endereço lido do QR e a chave de acesso dentro dele. */
export interface NfceQr {
  url: string;
  accessKey: string;
}

/**
 * Confere que o QR é de NFC-e: endereço http(s) de um site de governo (.gov.br),
 * com uma chave de acesso de 44 dígitos no parâmetro `p` (formato do QR da NFC-e:
 * `chave|versão|ambiente|...`).
 */
export function parseNfceQr(raw: string): NfceQr | { error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: "Esse QR Code não é de nota fiscal." };
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname.toLowerCase().endsWith(".gov.br")
  ) {
    return { error: "Esse QR Code não é de nota fiscal (NFC-e)." };
  }
  const p = (url.searchParams.get("p") ?? "").replace(/\s/g, "");
  const accessKey = /^\d{44}/.exec(p)?.[0];
  if (!accessKey) return { error: "Esse QR Code não traz a chave da nota." };
  return { url: url.toString(), accessKey };
}

/** O texto colado é da nota do QR? (a página da SEFAZ mostra a chave de acesso) */
export function pageHasKey(text: string, accessKey: string): boolean {
  return text.replace(/\D/g, "").includes(accessKey);
}

/**
 * CNPJ do emitente, de dentro da chave de acesso: UF (2) + AAMM (4) + CNPJ (14) +
 * modelo, série, número... A chave vem do QR, então o CNPJ dela é exato.
 */
export function cnpjFromKey(accessKey: string): string {
  return accessKey.slice(6, 20);
}

/** Maior texto colado aceito (uma nota longa dá ~15 mil caracteres). */
export const MAX_PAGE_TEXT = 100_000;

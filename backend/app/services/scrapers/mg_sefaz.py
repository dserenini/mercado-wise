"""Scraper de NFC-e da Sefaz Minas Gerais."""
import re
import logging
from datetime import datetime
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from app.config import settings
from app.services.scrapers.base import ScrapeResult

logger = logging.getLogger(__name__)

# Aliases carregados do banco (populados por reload_db_aliases no startup)
_DB_ALIASES: list[dict] = []


def reload_db_aliases() -> None:
    """Carrega (ou recarrega) os aliases de supermercado do banco."""
    global _DB_ALIASES
    try:
        from app.db import load_supermarket_aliases

        _DB_ALIASES = load_supermarket_aliases()
    except Exception as e:
        logger.error(f"Erro ao carregar aliases do banco: {e}")
        _DB_ALIASES = []


def extract_access_key_from_url(url: str) -> str | None:
    """Extrai a chave de acesso (44 dígitos) do parâmetro `p=` da URL do QR Code NFC-e."""
    try:
        m = re.search(r"[?&]p=([^|&]+)", url)
        if not m:
            return None
        chave = re.sub(r"[^0-9]", "", m.group(1))
        if len(chave) != 44:
            return None
        return chave
    except Exception as e:
        logger.warning(f"Não foi possível extrair a chave de acesso da URL: {e}")
        return None


def extract_cnpj_base_from_url(url: str) -> str | None:
    """Extrai os primeiros 8 dígitos do CNPJ a partir da URL do QR Code NFC-e."""
    try:
        m = re.search(r"[?&]p=([^|&]+)", url)
        if not m:
            return None
        chave = re.sub(r"[^0-9]", "", m.group(1))
        if len(chave) < 20:
            return None
        cnpj_base = chave[6:14]
        logger.info(f"🪪 CNPJ base extraído da URL: {cnpj_base}")
        return cnpj_base
    except Exception as e:
        logger.warning(f"Não foi possível extrair CNPJ da URL: {e}")
        return None


KNOWN_MARKETS = {
    "ATACADAO": "Atacadão", "ATACADÃO": "Atacadão",
    "ASSAI": "Assaí", "ASSAÍ": "Assaí",
    "CARREFOUR": "Carrefour", "EXTRA": "Extra",
    "PÃO DE AÇÚCAR": "Pão de Açúcar", "PAO DE ACUCAR": "Pão de Açúcar",
    "WALMART": "Walmart", "MUFFATO": "Super Muffato",
    "BH SUPERMERCADOS": "Supermercados BH", "SUPERMERCADOS BH": "Supermercados BH",
    "PREZUNIC": "Prezunic", "PAGUE MENOS": "Pague Menos",
    "BAHIA": "Casas Bahia", "MAKRO": "Makro",
    "SAM'S CLUB": "Sam's Club", "SAMS CLUB": "Sam's Club",
    "HORTIFRUTI": "Hortifruti", "NATURAL DA TERRA": "Natural da Terra",
    "REDE SMART": "Rede Smart", "SMART": "Smart",
    "COMPER": "Comper", "ANGELONI": "Angeloni", "ZAFFARI": "Zaffari",
    "BISTEK": "Bistek", "ENXUTO": "Enxuto", "MATEUS": "Mateus",
    "NORDESTÃO": "Nordestão", "NORDESTAO": "Nordestão",
    "SUPERNOSSO": "SuperNosso", "SUPER NOSSO": "SuperNosso",
    "EPA": "EPA", "NAGUMO": "Nagumo", "VERDEMAR": "Verdemar",
    "MINEIRÃO": "Mineirão", "MINEIRAO": "Mineirão", "ECOMIX": "Ecomix",
}

_NOISE_TOKENS = {
    "LTDA", "SA", "S/A", "S.A", "EIRELI", "EPP", "ME", "CIA",
    "COMERCIAL", "COMERCIO", "COML", "COM",
    "DE", "DO", "DA", "DOS", "DAS", "E",
    "ALIMENTOS", "DE ALIMENTOS", "PRODUTOS",
    "DISTRIBUIDORA", "DISTRIBUIDOR",
    "SUPERMERCADOS", "SUPERMERCADO",
    "HIPERMERCADOS", "HIPERMERCADO",
    "ATACADO", "ATACADISTA",
    "MERCADO", "MERCEARIA",
    "INDUSTRIA", "IND",
    "LTDA.", "S.A.", "CIA.",
}


def clean_market_name(raw: str, cnpj_base: str | None = None) -> str:
    """Limpa e normaliza o nome do supermercado. Ordem: CNPJ → alias BD → KNOWN_MARKETS → token-a-token."""
    if not raw or raw.strip() == "":
        return "Mercado Desconhecido"

    raw_upper = raw.upper().strip()

    if cnpj_base:
        for entry in _DB_ALIASES:
            if entry.get("cnpj_base") == cnpj_base:
                logger.info(f"🏪 Match por CNPJ {cnpj_base}: '{entry['display_name']}'")
                return entry["display_name"]

    for entry in _DB_ALIASES:
        if entry["alias"].upper() in raw_upper:
            logger.info(f"🏪 Match por alias '{entry['alias']}': '{entry['display_name']}'")
            return entry["display_name"]

    for key, display_name in KNOWN_MARKETS.items():
        if key.upper() in raw_upper:
            return display_name

    tokens = raw_upper.split()
    kept = []
    skip_next = False
    for i, token in enumerate(tokens):
        if skip_next:
            skip_next = False
            continue
        if token.isdigit():
            continue
        clean_token = token.strip(".,/")
        if clean_token in _NOISE_TOKENS:
            continue
        if clean_token == "SN" and i + 1 < len(tokens) and tokens[i + 1].isdigit():
            skip_next = True
            continue
        kept.append(token.strip(".,/"))

    cleaned = " ".join(kept).title().strip()
    if not cleaned or len(cleaned) < 2:
        return "Mercado Desconhecido"
    if len(cleaned) > 40:
        cleaned = cleaned[:40].rsplit(" ", 1)[0].strip()
    return cleaned


def extract_purchase_date(body_text: str, soup) -> str | None:
    """Extrai a data de emissão da nota. Retorna 'YYYY-MM-DD' ou None."""
    m = re.search(r"Emiss[aã]o\s*:?\s*(\d{2}/\d{2}/\d{4})", body_text, re.IGNORECASE)
    if m:
        try:
            return datetime.strptime(m.group(1), "%d/%m/%Y").date().isoformat()
        except ValueError:
            pass

    emissao_tag = soup.find(string=re.compile(r"Emiss[aã]o", re.I))
    if emissao_tag:
        parent = emissao_tag.parent
        sibling = parent.find_next_sibling()
        candidate_text = sibling.get_text() if sibling else parent.get_text()
        m2 = re.search(r"(\d{2}/\d{2}/\d{4})", candidate_text)
        if m2:
            try:
                return datetime.strptime(m2.group(1), "%d/%m/%Y").date().isoformat()
            except ValueError:
                pass

    m3 = re.search(r"(\d{2}/\d{2}/\d{4})", body_text)
    if m3:
        try:
            return datetime.strptime(m3.group(1), "%d/%m/%Y").date().isoformat()
        except ValueError:
            pass

    return None


def parse_brl_to_float(val_str: str) -> float:
    """Converte formato brasileiro/americano para float de forma segura."""
    clean = re.sub(r"[^\d\.,]", "", val_str)
    if not clean:
        return 0.0
    if "." in clean and "," in clean:
        clean = clean.replace(".", "").replace(",", ".")
    elif "," in clean:
        clean = clean.replace(",", ".")
    try:
        return float(clean)
    except ValueError:
        return 0.0


# "Código" pode chegar com mojibake (CÃ³digo/C�digo) dependendo do charset do portal
_CPROD_RE = re.compile(r"\(C.{0,3}?digo:?\s*(\d+)\s*\)", re.IGNORECASE)
_UNIT_RE = re.compile(r"UN:\s*([A-Za-z]{1,6})")


def _extract_cprod(text: str) -> str | None:
    """Extrai o código interno do produto de um trecho como '(Código: 42858)'."""
    m = _CPROD_RE.search(text)
    return m.group(1) if m else None


def _extract_emitente(soup, body_text: str) -> tuple[str | None, str | None]:
    """Extrai (cnpj completo, endereço) do bloco do emitente."""
    cnpj = None
    m = re.search(r"CNPJ:\s*([\d./-]{11,20})", body_text)
    if m:
        digits = re.sub(r"[^0-9]", "", m.group(1))
        if len(digits) == 14:
            cnpj = digits

    address = None
    try:
        cnpj_el = soup.find(string=re.compile(r"CNPJ:\s*[\d.]"))
        if cnpj_el:
            tr = cnpj_el.find_parent("tr")
            nxt = tr.find_next_sibling("tr") if tr else None
            if nxt:
                candidate = nxt.get_text(" ", strip=True)
                # Endereço plausível: tem vírgula e não é outro rótulo do layout
                if candidate and "," in candidate and "CNPJ" not in candidate:
                    address = candidate
    except Exception as e:
        logger.debug(f"Endereço do emitente não extraído: {e}")
    return cnpj, address


def _extract_payment_method(body_text: str) -> str | None:
    """Extrai a forma de pagamento (ex.: '04 - Cartão de Débito')."""
    m = re.search(
        r"Forma de Pagamento\s+(\d{2}\s*-\s*[^\d]{2,50}?)"
        r"(?=\s+(?:Consumidor|Chave|Informa|Valor|Troco|Qtde|\d)|$)",
        body_text,
    )
    return m.group(1).strip() if m else None


def _extract_access_key_from_page(body_text: str) -> str | None:
    """Extrai a chave de acesso exibida na página (formatada com pontuação)."""
    m = re.search(r"[Cc]have de acesso\s+([\d.\-/ ]{44,80})", body_text)
    if not m:
        return None
    digits = re.sub(r"[^0-9]", "", m.group(1))
    return digits[:44] if len(digits) >= 44 else None


def _parse_sefaz_html(html: str, url: str, cnpj_base: str | None) -> ScrapeResult:
    """Faz o parsing do HTML da Sefaz MG (separado para ser testável sem rede)."""
    soup = BeautifulSoup(html, "html.parser")

    raw_market_name = "Mercado Desconhecido"
    topo_div = soup.find("div", id="u20")
    if topo_div:
        raw_market_name = topo_div.get_text(strip=True)
    else:
        txt_topo = soup.find("div", class_="txtTopo")
        if txt_topo:
            raw_market_name = txt_topo.get_text(strip=True)

    total_amount = 0.0
    valor_el = soup.find(string=re.compile("Valor[\\s\\S]*Total", re.I))
    if valor_el:
        parent = valor_el.parent
        if parent:
            td_valor = parent.find_next_sibling("td") or parent.find_next("span", class_="txtMax")
            if td_valor:
                total_amount = parse_brl_to_float(td_valor.get_text())

    items_comprados = []

    # TENTATIVA 1: Tabela padronizada (Layout Clássico)
    tabela_produtos = soup.find("table", id="tabResult")
    if tabela_produtos:
        for linha in tabela_produtos.find_all("tr"):
            span_nome = linha.find("span", class_="txtTit")
            if not span_nome:
                continue
            nome = span_nome.get_text(strip=True)

            span_qtd = linha.find("span", class_="RCtd")
            qtd_val = 1.0
            if span_qtd and span_qtd.find("strong"):
                qtd_val = parse_brl_to_float(span_qtd.find("strong").get_text())

            span_un = linha.find("span", class_="RvlUnit")
            preco_un = 0.0
            if span_un and span_un.find("strong"):
                preco_un = parse_brl_to_float(span_un.find("strong").get_text())

            span_total = linha.find("span", class_="valor")
            total_item = parse_brl_to_float(span_total.get_text()) if span_total else 0.0

            linha_text = linha.get_text(" ", strip=True)
            unit = None
            m_un = _UNIT_RE.search(linha_text)
            if m_un:
                unit = m_un.group(1)

            items_comprados.append({
                "product_name": nome, "raw_name": nome,
                "cprod": _extract_cprod(linha_text), "unit": unit,
                "quantity": qtd_val, "unit_price": preco_un, "total_price": total_item,
            })

    body_text = soup.body.get_text(separator=" ", strip=True) if soup.body else ""

    purchase_date = extract_purchase_date(body_text, soup)
    if purchase_date:
        logger.info(f"📅 Data da nota extraída: {purchase_date}")
    else:
        logger.warning("⚠️ Não foi possível extrair a data da nota.")

    if raw_market_name == "Mercado Desconhecido":
        m_cnpj = re.search(r"([^\.]+)\s+CNPJ:", body_text)
        if m_cnpj:
            raw_market_name = m_cnpj.group(1).strip()
            raw_market_name = re.sub(r".*?\(NFC-e\)\s*", "", raw_market_name).strip()
            if not raw_market_name:
                raw_market_name = "Mercado Desconhecido"

    if total_amount == 0.0:
        m_pago = re.search(r"Valor pago R\$?\s*([\d\.,]+)", body_text, re.I)
        if m_pago:
            total_amount = parse_brl_to_float(m_pago.group(1))

    market_name = clean_market_name(raw_market_name, cnpj_base=cnpj_base)

    # TENTATIVA 2: Layout secundário (h7)
    if not items_comprados:
        for linha in soup.find_all("tr"):
            tds = linha.find_all("td")
            if not tds or len(tds) < 4:
                continue
            h7_nome = tds[0].find("h7")
            if not h7_nome:
                continue
            nome = h7_nome.get_text(strip=True)

            qtd_val = 1.0
            m_qtd = re.search(r"([\d\.,]+)", tds[1].get_text())
            if m_qtd:
                qtd_val = parse_brl_to_float(m_qtd.group(1))

            unit = None
            m_un = _UNIT_RE.search(tds[2].get_text())
            if m_un:
                unit = m_un.group(1)

            total_item = 0.0
            m_tot = re.search(r"R\$\s*([\d\.,]+)", tds[3].get_text())
            if m_tot:
                total_item = parse_brl_to_float(m_tot.group(1))

            preco_un = total_item / qtd_val if qtd_val > 0 else total_item
            items_comprados.append({
                "product_name": nome, "raw_name": nome,
                "cprod": _extract_cprod(tds[0].get_text(" ", strip=True)), "unit": unit,
                "quantity": qtd_val, "unit_price": preco_un, "total_price": total_item,
            })

    if market_name == "Mercado Desconhecido" and "S/A" in body_text:
        market_name = "Supermercado (Sefaz)"

    logger.info(f"🏪 Nome do mercado: '{raw_market_name}' → '{market_name}'")

    access_key = extract_access_key_from_url(url) or _extract_access_key_from_page(body_text)
    cnpj, market_address = _extract_emitente(soup, body_text)
    payment_method = _extract_payment_method(body_text)

    # Sem itens = a Sefaz não entregou a nota. Desde jul/2026 o portal do QR passou
    # a exigir captcha (reCAPTCHA + Cloudflare Turnstile): o servidor recebe só o
    # desafio anti-bot, sem a tabela de produtos. Falhamos aqui para NÃO gravar uma
    # compra vazia (0 itens / R$ 0) — o router traduz isso numa mensagem ao usuário.
    if not items_comprados:
        page_lc = html.lower()
        is_captcha = any(tok in page_lc for tok in ("g-recaptcha", "cf-turnstile", "recaptcha"))
        logger.warning(
            "⚠️ Nota sem itens — %s.",
            "desafio anti-bot (captcha) da Sefaz" if is_captcha
            else "página sem tabela de produtos",
        )
        return {
            "success": False,
            "error": "sefaz_inacessivel",
            "reason": "captcha" if is_captcha else "sem_itens",
            "supermarket_name": market_name,
            "access_key": access_key,
            "url": url,
        }

    return {
        "success": True,
        "supermarket_name": market_name,
        "raw_market_name": raw_market_name,
        "total_amount": total_amount,
        "purchase_date": purchase_date,
        "url": url,
        "access_key": access_key,
        "cnpj": cnpj,
        "cnpj_base": cnpj_base or (access_key[6:14] if access_key else None),
        "market_address": market_address,
        "payment_method": payment_method,
        "items": items_comprados,
    }


class MGSefazScraper:
    """Scraper da Sefaz MG. `handles` também é a allowlist anti-SSRF."""

    uf = "MG"

    def handles(self, url: str) -> bool:
        try:
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https"):
                return False
            host = (parsed.hostname or "").lower()
            if not host:
                return False
            return any(host == dom or host.endswith("." + dom) for dom in settings.sefaz_domains)
        except Exception:
            return False

    def scrape(self, url: str) -> ScrapeResult:
        cnpj_base = extract_cnpj_base_from_url(url)
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
        # O portal da Sefaz oscila — tenta 2x com timeout de leitura folgado.
        attempts = 2
        last_err: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                response = requests.get(
                    url, headers=headers, timeout=(5, settings.scraper_timeout)
                )
                response.raise_for_status()
            except requests.exceptions.RequestException as e:
                last_err = e
                logger.warning(f"Tentativa {attempt}/{attempts} falhou ao acessar a Sefaz: {e}")
                continue
            try:
                result = _parse_sefaz_html(response.text, url, cnpj_base)
                # HTML cru vai junto para persistência em receipts_raw (reprocessamento futuro)
                result["raw_html"] = response.text
                return result
            except Exception as e:
                logger.error(f"Erro ao parsear HTML da Sefaz MG: {e}")
                return {"success": False, "error": f"parse: {e}"}

        logger.error(f"Erro ao acessar a Sefaz MG após {attempts} tentativas: {last_err}")
        return {"success": False, "error": "sefaz_inacessivel", "reason": str(last_err)}

"""Registry de scrapers de NFC-e por UF.

Dispatch por domínio da URL. Como cada scraper só declara `handles=True` para os
domínios oficiais da sua UF, uma URL fora de qualquer domínio suportado não encontra
scraper e é recusada — isso É a proteção anti-SSRF.
"""
import logging

from app.services.scrapers.base import ReceiptScraper, ScrapeResult
from app.services.scrapers.mg_sefaz import MGSefazScraper, reload_db_aliases
from app.services.scrapers.qr import extract_url_from_image

logger = logging.getLogger(__name__)

# Registrar aqui novas UFs no futuro (ex.: SPFazendaScraper()).
_SCRAPERS: list[ReceiptScraper] = [MGSefazScraper()]


def get_scraper_for_url(url: str) -> ReceiptScraper | None:
    for scraper in _SCRAPERS:
        if scraper.handles(url):
            return scraper
    return None


def scrape_receipt(url: str) -> ScrapeResult:
    scraper = get_scraper_for_url(url)
    if scraper is None:
        logger.warning(f"🚫 Nenhum scraper para a URL (fora dos domínios suportados): {url}")
        return {"success": False, "error": "URL fora dos domínios de NFC-e suportados."}
    return scraper.scrape(url)


__all__ = [
    "scrape_receipt",
    "get_scraper_for_url",
    "extract_url_from_image",
    "reload_db_aliases",
]

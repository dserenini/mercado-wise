"""Contrato comum a todos os scrapers de NFC-e (um por UF)."""
from typing import Protocol, TypedDict, runtime_checkable


class ScrapedItem(TypedDict, total=False):
    product_name: str
    quantity: float
    unit_price: float
    total_price: float


class ScrapeResult(TypedDict, total=False):
    success: bool
    supermarket_name: str
    total_amount: float
    purchase_date: str | None
    url: str
    items: list[ScrapedItem]
    error: str


@runtime_checkable
class ReceiptScraper(Protocol):
    """Um scraper por UF. `handles` também funciona como allowlist anti-SSRF:
    só retorna True para os domínios oficiais daquela UF."""

    uf: str

    def handles(self, url: str) -> bool: ...

    def scrape(self, url: str) -> ScrapeResult: ...

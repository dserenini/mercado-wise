"""Testes das partes puras/frágeis: parsing de valores, nomes, fingerprint, allowlist e HTML."""
from pathlib import Path

import pytest

from app.services.scrapers.mg_sefaz import (
    parse_brl_to_float,
    clean_market_name,
    extract_cnpj_base_from_url,
    _parse_sefaz_html,
    MGSefazScraper,
)
from app.services.dedup import compute_items_fingerprint

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.parametrize("raw,expected", [
    ("1.234,56", 1234.56),
    ("62,65", 62.65),
    ("R$ 25,90", 25.90),
    ("62.65", 62.65),
    ("", 0.0),
    ("abc", 0.0),
])
def test_parse_brl_to_float(raw, expected):
    assert parse_brl_to_float(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("SUPERMERCADO ATACADAO S/A", "Atacadão"),
    ("ASSAI ATACADISTA LTDA", "Assaí"),
    ("COMERCIAL DE ALIMENTOS XYZ LTDA", "Xyz"),
    ("", "Mercado Desconhecido"),
])
def test_clean_market_name(raw, expected):
    assert clean_market_name(raw) == expected


def test_extract_cnpj_base_from_url():
    # Chave NF-e de 44 dígitos: CNPJ base (posições 6-13) = "12345678"
    chave = "31" + "2603" + "12345678000199" + "65" + "001" + "000000123" + "1" + "12345678" + "9"
    url = f"https://nfce.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml?p={chave}|2|1|1|abc"
    assert extract_cnpj_base_from_url(url) == "12345678"


def test_compute_items_fingerprint_is_order_independent():
    a = [
        {"product_name": "ARROZ", "quantity": 2, "unit_price": 25.90},
        {"product_name": "FEIJAO", "quantity": 1, "unit_price": 8.49},
    ]
    b = list(reversed(a))
    assert compute_items_fingerprint(a) == compute_items_fingerprint(b)


def test_compute_items_fingerprint_differs_on_change():
    a = [{"product_name": "ARROZ", "quantity": 2, "unit_price": 25.90}]
    b = [{"product_name": "ARROZ", "quantity": 3, "unit_price": 25.90}]
    assert compute_items_fingerprint(a) != compute_items_fingerprint(b)


@pytest.mark.parametrize("url,allowed", [
    ("https://nfce.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml?p=1", True),
    ("https://www.sefaz.mg.gov.br/algo", True),
    ("http://169.254.169.254/latest/meta-data/", False),   # SSRF metadata
    ("http://localhost:8000/", False),
    ("https://evil.com/?x=fazenda.mg.gov.br", False),      # domínio na query, não no host
    ("ftp://nfce.fazenda.mg.gov.br/x", False),             # esquema não-HTTP
])
def test_scraper_handles_allowlist(url, allowed):
    assert MGSefazScraper().handles(url) is allowed


def test_parse_sefaz_html_classic_layout():
    html = (FIXTURES / "sefaz_mg_classic.html").read_text(encoding="utf-8")
    result = _parse_sefaz_html(html, url="https://nfce.fazenda.mg.gov.br/x", cnpj_base=None)

    assert result["success"] is True
    assert result["supermarket_name"] == "Atacadão"
    assert result["total_amount"] == 60.29
    assert result["purchase_date"] == "2026-03-15"
    assert len(result["items"]) == 2

    arroz = result["items"][0]
    assert arroz["product_name"] == "ARROZ TIPO 1 5KG"
    assert arroz["quantity"] == 2
    assert arroz["unit_price"] == 25.90
    assert arroz["total_price"] == 51.80

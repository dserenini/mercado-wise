"""Testes da resolução de GTIN (validação + parsing da Open Food Facts)."""
import pytest

from app.services import gtin as gtin_mod
from app.services.gtin import is_valid_gtin, _from_openfoodfacts


@pytest.mark.parametrize("code,ok", [
    ("7891000100103", True),   # EAN-13
    ("12345678", True),        # EAN-8
    ("7891000100103123", False),  # longo demais
    ("789100010010X", False),  # não-dígito
    ("", False),
    ("123", False),
])
def test_is_valid_gtin(code, ok):
    assert is_valid_gtin(code) is ok


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_from_off_parses_product_quantity(monkeypatch):
    payload = {
        "status": 1,
        "product": {
            "product_name": "Leite Condensado Moça",
            "brands": "Nestlé, Moça",
            "product_quantity": "395",
            "product_quantity_unit": "g",
            "quantity": "395 g",
        },
    }
    monkeypatch.setattr(gtin_mod.requests, "get", lambda *a, **k: _FakeResp(payload))
    out = _from_openfoodfacts("7891000100103")
    assert out["found"] is True
    assert out["name"] == "Leite Condensado Moça"
    assert out["brand"] == "Nestlé"          # só a primeira marca
    assert out["package_size"] == 395.0
    assert out["package_unit"] == "g"


def test_from_off_falls_back_to_quantity_string(monkeypatch):
    payload = {
        "status": 1,
        "product": {"product_name": "Refrigerante", "brands": "X", "quantity": "2 L"},
    }
    monkeypatch.setattr(gtin_mod.requests, "get", lambda *a, **k: _FakeResp(payload))
    out = _from_openfoodfacts("7891000000000")
    assert out["package_size"] == 2.0
    assert out["package_unit"] == "l"


def test_from_off_not_found(monkeypatch):
    monkeypatch.setattr(gtin_mod.requests, "get", lambda *a, **k: _FakeResp({"status": 0}))
    out = _from_openfoodfacts("0000000000000")
    assert out["found"] is False

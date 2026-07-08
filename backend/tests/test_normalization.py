"""Testes da normalização F2: extração de embalagem, resolução e pipeline."""
import pytest

from app.services.dedup import (
    extract_package_from_name,
    resolve_package,
    process_scraped_items,
)


@pytest.mark.parametrize("name,size,unit", [
    ("PAO FOR.IND.500G", 500.0, "g"),
    ("REFRI COCA COLA 2L", 2.0, "L".lower()),
    ("SABAO OMO 1,6KG", 1.6, "kg"),
    ("LEITE INTEGRAL 1L", 1.0, "l"),
    ("BISCOITO 200 ML", 200.0, "ml"),
    ("PAO FR.ASS.kg", None, None),        # 'kg' sem número → não é embalagem
    ("MEXERICA PON.EX.kg", None, None),
    ("ARROZ TIPO 1", None, None),
])
def test_extract_package_from_name(name, size, unit):
    assert extract_package_from_name(name) == (size, unit)


def test_resolve_package_weighable_unit():
    """Item vendido a peso: preço já é R$/medida → package_size=1."""
    item = {"raw_name": "PAO FR.ASS.kg", "unit": "kg"}
    resolve_package(item, None)
    assert item["package_size"] == 1
    assert item["package_unit"] == "kg"


def test_resolve_package_from_name_regex():
    item = {"raw_name": "PAO FOR.IND.500G", "unit": "UN"}
    resolve_package(item, None)
    assert item["package_size"] == 500.0
    assert item["package_unit"] == "g"


def test_resolve_package_prefers_dictionary_entry():
    item = {"raw_name": "REFRI COCA", "unit": "UN"}
    resolve_package(item, {"package_size": 2, "package_unit": "L"})
    assert item["package_size"] == 2
    assert item["package_unit"] == "L"


def test_resolve_package_keeps_existing():
    item = {"raw_name": "X", "unit": "UN", "package_size": 900, "package_unit": "ml"}
    resolve_package(item, {"package_size": 2, "package_unit": "L"})
    assert item["package_size"] == 900


# ── Pipeline com BD falso (sem dicionário, sem IA) ──────────────────

class _FakeExec:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Ignora filtros; sempre devolve os dados configurados por tabela."""
    def __init__(self, data):
        self._data = data

    def select(self, *a, **k): return self
    def eq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def is_(self, *a, **k): return self
    def insert(self, *a, **k): return self
    def execute(self): return _FakeExec(self._data)


class _FakeDB:
    def table(self, name):
        return _FakeQuery([])   # dicionário vazio → tudo desconhecido


class _AIOff:
    def is_configured(self): return False


def test_pipeline_fills_package_without_dict_or_ai():
    """Sem dicionário e sem IA, a embalagem ainda é resolvida por unidade/regex."""
    items = [
        {"product_name": "PAO FR.ASS.kg", "raw_name": "PAO FR.ASS.kg",
         "cprod": "42858", "unit": "kg", "quantity": 0.38, "unit_price": 21.78, "total_price": 8.28},
        {"product_name": "PAO FOR.IND.500G", "raw_name": "PAO FOR.IND.500G",
         "cprod": "33141", "unit": "UN", "quantity": 1, "unit_price": 5.48, "total_price": 5.48},
    ]
    out = process_scraped_items(_FakeDB(), items, _AIOff(), cnpj_base="01928075")

    kg_item, un_item = out
    # Item a peso vira R$/kg (package_size=1)
    assert kg_item["package_size"] == 1
    assert kg_item["package_unit"] == "kg"
    # Item contável tem embalagem extraída do nome
    assert un_item["package_size"] == 500.0
    assert un_item["package_unit"] == "g"
    # Sem entrada no dicionário, o nome cru é preservado
    assert kg_item["product_name"] == "PAO FR.ASS.kg"


def test_pipeline_applies_dictionary_by_cprod():
    """Entrada de dicionário por (cnpj_base, cprod) normaliza nome, marca e embalagem."""
    class _DictDB:
        def table(self, name):
            if name == "product_dictionary":
                return _FakeQuery([{
                    "raw_name": "REFRI COCA COLA 2L", "cprod": "77777",
                    "normalized_name": "Refrigerante Cola", "brand": "Coca-Cola",
                    "unit": "L", "package_size": 2, "package_unit": "L", "category": "Bebidas",
                }])
            return _FakeQuery([])

    items = [{
        "product_name": "REFRI COCA COLA 2L", "raw_name": "REFRI COCA COLA 2L",
        "cprod": "77777", "unit": "UN", "quantity": 1, "unit_price": 8.0, "total_price": 8.0,
    }]
    out = process_scraped_items(_DictDB(), items, _AIOff(), cnpj_base="00000001")
    assert out[0]["product_name"] == "Refrigerante Cola"
    assert out[0]["brand"] == "Coca-Cola"
    assert out[0]["package_size"] == 2
    assert out[0]["package_unit"] == "L"

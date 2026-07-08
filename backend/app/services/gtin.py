"""Resolução de produto por GTIN (código de barras).

Cache em `gtin_catalog` (tabela global) → miss consulta a Open Food Facts.
Host fixo + GTIN validado só com dígitos ⇒ sem risco de SSRF.
"""
import logging
import re

import requests

from app.db import db
from app.services.dedup import extract_package_from_name

logger = logging.getLogger(__name__)

_OFF_URL = "https://world.openfoodfacts.org/api/v2/product/{gtin}.json"
_OFF_FIELDS = "product_name,product_name_pt,brands,quantity,product_quantity,product_quantity_unit"
_OFF_TIMEOUT = (5, 6)  # (connect, read)


def is_valid_gtin(gtin: str) -> bool:
    """Aceita EAN-8/12/13/14 (só dígitos)."""
    return bool(re.fullmatch(r"\d{8,14}", gtin or ""))


def _from_openfoodfacts(gtin: str) -> dict | None:
    """Consulta a Open Food Facts. Retorna metadados ou None se indisponível/erro."""
    try:
        resp = requests.get(
            _OFF_URL.format(gtin=gtin),
            params={"fields": _OFF_FIELDS},
            headers={"User-Agent": "MercadoFacil/1.0 (+https://mercadofacil.app)"},
            timeout=_OFF_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
    except (requests.exceptions.RequestException, ValueError) as e:
        logger.warning(f"Open Food Facts indisponível para {gtin}: {e}")
        return None

    if data.get("status") != 1 or not data.get("product"):
        return {"gtin": gtin, "found": False, "source": "openfoodfacts"}

    prod = data["product"]
    name = (prod.get("product_name_pt") or prod.get("product_name") or "").strip() or None
    brand = (prod.get("brands") or "").split(",")[0].strip() or None

    package_size = None
    package_unit = None
    pq = prod.get("product_quantity")
    pqu = (prod.get("product_quantity_unit") or "").lower() or None
    if pq:
        try:
            package_size = float(pq)
            package_unit = pqu or "g"
        except (ValueError, TypeError):
            package_size = None
    if package_size is None:
        package_size, package_unit = extract_package_from_name(prod.get("quantity"))

    return {
        "gtin": gtin,
        "name": name,
        "brand": brand,
        "package_size": package_size,
        "package_unit": package_unit,
        "found": name is not None,
        "source": "openfoodfacts",
    }


def resolve_gtin(gtin: str) -> dict | None:
    """Resolve um GTIN: cache no catálogo → Open Food Facts (e grava no cache)."""
    if not db or not is_valid_gtin(gtin):
        return None

    # 1. Cache
    try:
        res = db.table("gtin_catalog").select("*").eq("gtin", gtin).limit(1).execute()
        if res.data:
            return res.data[0]
    except Exception as e:
        logger.error(f"Erro ao ler gtin_catalog: {e}")

    # 2. Open Food Facts
    off = _from_openfoodfacts(gtin)
    if off is None:
        return None  # fonte externa indisponível — não cacheia (tenta de novo depois)

    # 3. Grava no cache (inclusive not-found, para não repetir a consulta externa)
    entry = {
        "gtin": gtin,
        "name": off.get("name"),
        "brand": off.get("brand"),
        "package_size": off.get("package_size"),
        "package_unit": off.get("package_unit"),
        "source": off.get("source"),
        "found": off.get("found", False),
    }
    try:
        db.table("gtin_catalog").upsert(entry, on_conflict="gtin").execute()
    except Exception as e:
        logger.warning(f"Não foi possível cachear GTIN {gtin}: {e}")

    return entry

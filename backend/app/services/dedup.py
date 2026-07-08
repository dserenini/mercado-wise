"""Normalização de itens (dicionário global + Gemini) e detecção de duplicatas."""
import hashlib
import logging
import re

from app.services.ai_normalizer import AINormalizerService

logger = logging.getLogger(__name__)

# Unidades de peso/volume vendidas a granel: o preço unitário já é R$/medida.
_WEIGHABLE_UNITS = {"kg", "g", "l", "ml"}
# Tamanho de embalagem embutido no nome cru ("...500G", "...2L", "1,6KG")
_PKG_IN_NAME_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml)\b", re.IGNORECASE)

# Colunas válidas de purchase_items que a normalização pode preencher.
# Protege o insert de chaves estranhas vindas do dicionário/IA.
ITEM_COLUMNS = {
    "product_name", "raw_name", "cprod", "unit", "brand",
    "quantity", "unit_price", "total_price",
    "package_size", "package_unit",
}


def extract_package_from_name(name: str | None) -> tuple[float | None, str | None]:
    """Extrai (tamanho, unidade) de embalagem embutido no nome cru. Ex.: 'PAO 500G' -> (500, 'g')."""
    if not name:
        return (None, None)
    matches = _PKG_IN_NAME_RE.findall(name)
    if not matches:
        return (None, None)
    size_str, unit = matches[-1]  # o sufixo costuma ser o último match
    try:
        return (float(size_str.replace(",", ".")), unit.lower())
    except ValueError:
        return (None, None)


def resolve_package(item: dict, entry: dict | None) -> None:
    """Preenche package_size/package_unit no item (in-place). Prioridade:
    1) já definido; 2) unidade de peso da Sefaz (R$/medida direto);
    3) tamanho do dicionário/IA; 4) regex no nome cru."""
    if item.get("package_size"):
        return

    unit = (item.get("unit") or "").lower()
    if unit in _WEIGHABLE_UNITS:
        item["package_size"] = 1
        item["package_unit"] = unit
        return

    if entry and entry.get("package_size"):
        item["package_size"] = entry["package_size"]
        item["package_unit"] = entry.get("package_unit")
        return

    size, punit = extract_package_from_name(item.get("raw_name") or item.get("product_name"))
    if size:
        item["package_size"] = size
        item["package_unit"] = punit


def compute_items_fingerprint(items: list[dict]) -> str:
    """Hash MD5 dos itens ordenados para comparação de duplicatas."""
    sorted_items = sorted(items, key=lambda x: x.get("product_name", "").upper())
    parts = [
        f"{i['product_name'].upper().strip()}:{round(i.get('quantity', 1), 2)}:{round(i.get('unit_price', 0), 2)}"
        for i in sorted_items
    ]
    return hashlib.md5("|".join(parts).encode()).hexdigest()


_DICT_FIELDS = "raw_name, cprod, normalized_name, brand, unit, package_size, package_unit, category"


def _apply_entry(item: dict, entry: dict | None) -> None:
    """Aplica a normalização (nome, marca, embalagem) a um item, in-place."""
    item.setdefault("raw_name", item.get("product_name"))
    if entry:
        item["product_name"] = entry.get("normalized_name") or item["product_name"]
        if entry.get("brand") is not None:
            item["brand"] = entry["brand"]
    resolve_package(item, entry)


def process_scraped_items(db_client, raw_items: list[dict], ai: AINormalizerService,
                          cnpj_base: str | None = None) -> list[dict]:
    """Normaliza os itens. Identidade: (cnpj_base, cProd) primeiro, raw_name como fallback,
    Gemini como último recurso. Preenche nome normalizado, marca e embalagem (in-place).

    Camada 1 = dicionário no BD (Service Role, tabela global); camada 2 = Gemini.
    """
    if not db_client or not raw_items:
        return raw_items

    unique_raw_names = list({it["product_name"] for it in raw_items})
    cprods = list({it["cprod"] for it in raw_items if it.get("cprod")})

    try:
        # Camada 1a: identidade por mercado (cnpj_base, cprod)
        by_cprod: dict[str, dict] = {}
        if cnpj_base and cprods:
            res_c = (
                db_client.table("product_dictionary")
                .select(_DICT_FIELDS)
                .eq("cnpj_base", cnpj_base)
                .in_("cprod", cprods)
                .execute()
            )
            by_cprod = {r["cprod"]: r for r in (res_c.data or []) if r.get("cprod")}

        # Camada 1b: fallback genérico por raw_name (entradas sem cprod)
        res = (
            db_client.table("product_dictionary")
            .select(_DICT_FIELDS)
            .in_("raw_name", unique_raw_names)
            .is_("cprod", "null")
            .execute()
        )
        by_raw = {r["raw_name"]: r for r in (res.data or [])}

        def lookup(it: dict) -> dict | None:
            cp = it.get("cprod")
            if cp and cp in by_cprod:
                return by_cprod[cp]
            return by_raw.get(it["product_name"])

        unknown_names = list({
            it["product_name"] for it in raw_items if lookup(it) is None
        })

        # Camada 2: Gemini para os desconhecidos
        ai_map: dict[str, dict] = {}
        if unknown_names and ai.is_configured():
            ai_map = ai.normalize_products_batch(unknown_names)
            if ai_map:
                new_entries = []
                seen_keys = set()
                for it in raw_items:
                    rn = it["product_name"]
                    data = ai_map.get(rn)
                    if not data or lookup(it) is not None:
                        continue
                    cp = it.get("cprod")
                    key = (cnpj_base, cp) if (cnpj_base and cp) else ("raw", rn)
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    entry = {
                        "raw_name": rn,
                        "normalized_name": data["normalized_name"],
                        "brand": data.get("brand"),
                        "unit": data.get("unit"),
                        "package_size": data.get("package_size"),
                        "package_unit": data.get("package_unit"),
                        "category": data.get("category", "Geral"),
                        "status": "pending",
                        "confidence_score": 1,
                    }
                    if cnpj_base and cp:
                        entry["cnpj_base"] = cnpj_base
                        entry["cprod"] = cp
                    new_entries.append(entry)
                try:
                    if new_entries:
                        db_client.table("product_dictionary").insert(new_entries).execute()
                        logger.info(f"💾 {len(new_entries)} novos produtos no dicionário (PENDING).")
                except Exception as e:
                    logger.error(f"Erro ao salvar novas traduções IA no BD: {e}")

        # Aplica a normalização a cada item
        for item in raw_items:
            entry = lookup(item) or ai_map.get(item["product_name"])
            _apply_entry(item, entry)

    except Exception as e:
        logger.error(f"Erro no pipeline de normalização de produtos: {e}")
        for item in raw_items:
            _apply_entry(item, None)

    return raw_items


def check_duplicate(client, user_id: str, url_sefaz: str, mercado: str,
                    purchase_date: str | None, items: list[dict],
                    access_key: str | None = None) -> dict | None:
    """Detecta nota já cadastrada pelo usuário (usa o client autenticado — RLS ativa).

    Camadas: (1) chave de acesso da NFC-e; (2) URL; (3) mercado + data + fingerprint dos itens.
    """
    if not client:
        return None

    try:
        if access_key:
            res = (
                client.table("purchase_history")
                .select("id, supermarket_name, purchase_date, total_amount")
                .eq("user_id", user_id)
                .eq("access_key", access_key)
                .limit(1)
                .execute()
            )
            if res.data:
                existing = res.data[0]
                logger.warning(f"⚠️ Duplicata por chave de acesso: compra #{existing['id']}")
                return {"layer": "access_key", "existing": existing}

        res = (
            client.table("purchase_history")
            .select("id, supermarket_name, purchase_date, total_amount")
            .eq("user_id", user_id)
            .eq("nfc_url", url_sefaz)
            .limit(1)
            .execute()
        )
        if res.data:
            existing = res.data[0]
            logger.warning(f"⚠️ Duplicata por URL: compra #{existing['id']}")
            return {"layer": "url", "existing": existing}

        if purchase_date and items:
            res2 = (
                client.table("purchase_history")
                .select("id, supermarket_name, purchase_date, total_amount, "
                        "purchase_items(product_name, quantity, unit_price)")
                .eq("user_id", user_id)
                .eq("supermarket_name", mercado)
                .eq("purchase_date", purchase_date)
                .execute()
            )
            if res2.data:
                new_fp = compute_items_fingerprint(items)
                for purchase in res2.data:
                    existing_items = purchase.get("purchase_items", [])
                    if existing_items and compute_items_fingerprint(existing_items) == new_fp:
                        logger.warning(f"⚠️ Duplicata por fingerprint: compra #{purchase['id']}")
                        return {"layer": "fingerprint", "existing": purchase}
    except Exception as e:
        logger.error(f"Erro ao verificar duplicata: {e}")

    return None

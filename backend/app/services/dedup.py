"""Normalização de itens (dicionário global + Gemini) e detecção de duplicatas."""
import hashlib
import logging

from app.services.ai_normalizer import AINormalizerService

logger = logging.getLogger(__name__)


def compute_items_fingerprint(items: list[dict]) -> str:
    """Hash MD5 dos itens ordenados para comparação de duplicatas."""
    sorted_items = sorted(items, key=lambda x: x.get("product_name", "").upper())
    parts = [
        f"{i['product_name'].upper().strip()}:{round(i.get('quantity', 1), 2)}:{round(i.get('unit_price', 0), 2)}"
        for i in sorted_items
    ]
    return hashlib.md5("|".join(parts).encode()).hexdigest()


def process_scraped_items(db_client, raw_items: list[dict], ai: AINormalizerService) -> list[dict]:
    """Normaliza nomes: camada 1 = dicionário no BD (Service Role, tabela global); camada 2 = Gemini."""
    if not db_client or not raw_items:
        return raw_items

    unique_raw_names = list({it["product_name"] for it in raw_items})

    try:
        res = (
            db_client.table("product_dictionary")
            .select("raw_name, normalized_name")
            .in_("raw_name", unique_raw_names)
            .execute()
        )
        known_map = {r["raw_name"]: r for r in res.data} if res.data else {}
        unknown_names = [n for n in unique_raw_names if n not in known_map]

        ai_map: dict[str, dict] = {}
        if unknown_names and ai.is_configured():
            ai_map = ai.normalize_products_batch(unknown_names)
            if ai_map:
                new_entries = [
                    {
                        "raw_name": raw_str,
                        "normalized_name": data["normalized_name"],
                        "unit": data.get("unit"),
                        "category": data.get("category", "Geral"),
                        "status": "pending",
                        "confidence_score": 1,
                    }
                    for raw_str, data in ai_map.items()
                ]
                try:
                    db_client.table("product_dictionary").insert(new_entries).execute()
                    logger.info(f"💾 {len(new_entries)} novos produtos adicionados ao dicionário (PENDING).")
                except Exception as e:
                    logger.error(f"Erro ao salvar novas traduções IA no BD: {e}")

        for item in raw_items:
            raw_name = item["product_name"]
            item.setdefault("raw_name", raw_name)
            if raw_name in known_map:
                item["product_name"] = known_map[raw_name]["normalized_name"]
            elif raw_name in ai_map:
                item["product_name"] = ai_map[raw_name]["normalized_name"]

    except Exception as e:
        logger.error(f"Erro no pipeline de normalização de produtos: {e}")

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

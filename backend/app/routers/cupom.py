"""Endpoint de upload/leitura de cupom fiscal (NFC-e)."""
import logging
import re

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Request
from fastapi.concurrency import run_in_threadpool

from app.config import settings
from app.db import db, user_client
from app.dependencies import get_current_user, CurrentUser
from app.limiter import limiter
from app.services.ai_normalizer import AINormalizerService
from app.services.dedup import process_scraped_items, check_duplicate, ITEM_COLUMNS
from app.services.scrapers import extract_url_from_image, scrape_receipt
from app.services.scrapers.mg_sefaz import _parse_sefaz_html

# Colunas derivadas/proveniência que o reprocessamento pode sobrescrever com
# segurança (não toca quantidade/preço/promoção/nota/soft-delete do usuário).
_REPROCESS_FIELDS = ("product_name", "raw_name", "cprod", "unit", "brand",
                     "package_size", "package_unit")

logger = logging.getLogger(__name__)
router = APIRouter()
ai_service = AINormalizerService()

# Versão do parser da Sefaz — gravada em receipts_raw para reprocessamento seletivo
PARSER_VERSION = 2


def _upsert_supermarket(cnpj: str | None, name: str, address: str | None) -> str | None:
    """Alimenta a tabela global `supermarkets` (via Service Role) e retorna o id."""
    if not db or not cnpj:
        return None
    try:
        city = None
        if address:
            m = re.search(r"-\s*([^,\-]+),\s*[A-Z]{2}\s*$", address)
            if m:
                city = m.group(1).strip().title()
        payload = {"cnpj": cnpj, "name": name}
        if address:
            payload["address"] = address
        if city:
            payload["city"] = city
        res = db.table("supermarkets").upsert(payload, on_conflict="cnpj").execute()
        return res.data[0].get("id") if res.data else None
    except Exception as e:
        logger.warning(f"Não foi possível alimentar supermarkets ({cnpj}): {e}")
        return None


def _persist_purchase(access_token, user_id, force, url_sefaz, mercado, total,
                      purchase_date, itens, access_key=None, cnpj=None,
                      payment_method=None, supermarket_id=None, raw_html=None) -> dict:
    """Bloqueante (roda em threadpool): checa duplicata e grava sob RLS."""
    uc = user_client(access_token)
    if not uc:
        raise HTTPException(status_code=503, detail="Serviço de banco indisponível.")

    if not force:
        dup = check_duplicate(uc, user_id, url_sefaz, mercado, purchase_date, itens,
                              access_key=access_key)
        if dup:
            return {"outcome": "duplicate", "layer": dup["layer"], "existing": dup["existing"]}

    purchase_payload = {
        "user_id": user_id,
        "supermarket_name": mercado,
        "total_amount": total,
        "nfc_url": url_sefaz,
        "access_key": access_key,
        "cnpj": cnpj,
        "payment_method": payment_method,
    }
    if supermarket_id:
        purchase_payload["supermarket_id"] = supermarket_id
    if purchase_date:
        purchase_payload["purchase_date"] = purchase_date

    res = uc.table("purchase_history").insert(purchase_payload).execute()
    purchase_id = res.data[0].get("id")

    if itens:
        rows = [
            {k: v for k, v in item.items() if k in ITEM_COLUMNS} | {"purchase_id": purchase_id}
            for item in itens
        ]
        uc.table("purchase_items").insert(rows).execute()

    # HTML cru para reprocessamento futuro — falha aqui não invalida a compra
    if access_key and raw_html:
        try:
            uc.table("receipts_raw").upsert(
                {
                    "user_id": user_id,
                    "access_key": access_key,
                    "nfc_url": url_sefaz,
                    "raw_html": raw_html,
                    "parser_version": PARSER_VERSION,
                },
                on_conflict="user_id,access_key",
            ).execute()
        except Exception as e:
            logger.warning(f"receipts_raw não gravado (compra #{purchase_id}): {e}")

    return {"outcome": "saved", "purchase_id": purchase_id}


@router.post("/upload-cupom")
@limiter.limit("20/minute")
async def extract_receipt_data(
    request: Request,
    file: UploadFile = File(...),
    force_save: str = Form("false"),
    current_user: CurrentUser = Depends(get_current_user),
):
    user_id = current_user.id
    force = force_save.lower() == "true"
    logger.info(f"📸 Arquivo: {file.filename} | user: {user_id} | force: {force}")

    # 1. Validação de tipo
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Ei, mande a foto do cupom!")

    # 1b. Rejeição rápida por tamanho (header)
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"Imagem muito grande (máx {settings.max_upload_mb:.0f} MB).")

    # 2. Ler imagem (com teto de segurança)
    img_bytes = await file.read()
    logger.info(f"💾 Tamanho: {len(img_bytes) / 1024 / 1024:.2f} MB")
    if len(img_bytes) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"Imagem muito grande (máx {settings.max_upload_mb:.0f} MB).")
    if not img_bytes:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")

    # 3. Extrair URL do QR Code (CPU-bound → threadpool)
    url_sefaz, layer_used = await run_in_threadpool(extract_url_from_image, img_bytes)
    if not url_sefaz:
        raise HTTPException(status_code=400, detail="Não foi possível ler a nota. Considere a Leitura por uma IA")
    logger.info(f"🔗 URL: {url_sefaz}")

    # 4. Scraping (rede → threadpool). O registry recusa domínios fora da allowlist (anti-SSRF).
    scraping_result = await run_in_threadpool(scrape_receipt, url_sefaz)
    if not scraping_result.get("success"):
        raise HTTPException(status_code=502, detail="Não foi possível ler os dados da nota na Sefaz.")

    mercado = scraping_result.get("supermarket_name", "Desconhecido")
    total = scraping_result.get("total_amount", 0.0)
    purchase_date = scraping_result.get("purchase_date")
    itens_raw = scraping_result.get("items", [])
    access_key = scraping_result.get("access_key")
    cnpj = scraping_result.get("cnpj")
    cnpj_base = scraping_result.get("cnpj_base")
    payment_method = scraping_result.get("payment_method")
    market_address = scraping_result.get("market_address")
    # O HTML cru não volta na resposta — só vai para receipts_raw
    raw_html = scraping_result.pop("raw_html", None)

    # 5. Normalização (rede/BD global → threadpool)
    itens = await run_in_threadpool(
        process_scraped_items, db, itens_raw, ai_service, cnpj_base
    )
    scraping_result["items"] = itens

    # 5b. Catálogo global de mercados (Service Role, tabela global)
    supermarket_id = await run_in_threadpool(_upsert_supermarket, cnpj, mercado, market_address)

    # 6. Persistência sob RLS (BD → threadpool)
    try:
        result = await run_in_threadpool(
            _persist_purchase, current_user.access_token, user_id, force,
            url_sefaz, mercado, total, purchase_date, itens,
            access_key, cnpj, payment_method, supermarket_id, raw_html,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Erro de Banco: {e}")
        raise HTTPException(status_code=500, detail="Erro ao salvar a nota. Tente novamente.")

    if result["outcome"] == "duplicate":
        existing = result["existing"]
        reason = {
            "access_key": "mesma chave de acesso da nota fiscal",
            "url": "mesma URL da nota fiscal",
        }.get(result["layer"], "mesmo mercado, data e itens")
        logger.info(f"🚫 Duplicata bloqueada ({reason}). Aguardando confirmação.")
        return {
            "success": False,
            "status": "duplicate",
            "mensagem": f"Esta nota já está no seu histórico ({reason}).",
            "existing": {
                "id": existing.get("id"),
                "supermarket_name": existing.get("supermarket_name"),
                "purchase_date": existing.get("purchase_date"),
                "total_amount": existing.get("total_amount"),
            },
            "scraped_data": scraping_result,
        }

    logger.info(f"✅ Compra #{result['purchase_id']} registrada{' (forçada)' if force else ''}.")
    return {
        "success": True,
        "status": "saved",
        "mensagem": f"Método({layer_used}) Lemos {len(itens)} produtos no valor de R$ {total:.2f} do {mercado} e salvamos!",
        "data": scraping_result,
    }


def _match_key(it: dict) -> tuple:
    """Chave estável de um item entre o cru re-parseado e o armazenado (invariante à normalização)."""
    return (round(float(it.get("quantity") or 0), 3), round(float(it.get("unit_price") or 0), 2))


def _reprocess_user_history(access_token, user_id) -> dict:
    """Relê receipts_raw do usuário, re-parseia e re-normaliza, fazendo backfill dos
    campos derivados (nome normalizado, marca, embalagem, cProd, unidade) sem tocar
    em quantidade/preço/promoção/nota/soft-delete."""
    uc = user_client(access_token)
    if not uc:
        raise HTTPException(status_code=503, detail="Serviço de banco indisponível.")

    receipts = uc.table("receipts_raw").select("access_key, raw_html, nfc_url").execute()
    receipts_data = receipts.data or []
    purchases_touched = 0
    items_updated = 0

    for rec in receipts_data:
        access_key = rec.get("access_key")
        raw_html = rec.get("raw_html")
        if not access_key or not raw_html:
            continue

        cnpj_base = access_key[6:14] if len(access_key) >= 14 else None
        parsed = _parse_sefaz_html(raw_html, rec.get("nfc_url") or "", cnpj_base)
        if not parsed.get("success"):
            continue
        fresh_items = process_scraped_items(db, parsed.get("items", []), ai_service, cnpj_base)

        purch = (
            uc.table("purchase_history")
            .select("id")
            .eq("user_id", user_id)
            .eq("access_key", access_key)
            .limit(1)
            .execute()
        )
        if not purch.data:
            continue
        purchase_id = purch.data[0]["id"]

        stored = (
            uc.table("purchase_items")
            .select("id, quantity, unit_price")
            .eq("purchase_id", purchase_id)
            .execute()
        )
        # Índice de itens armazenados por chave estável (pode haver repetidos)
        buckets: dict[tuple, list] = {}
        for si in (stored.data or []):
            buckets.setdefault(_match_key(si), []).append(si["id"])

        for fi in fresh_items:
            ids = buckets.get(_match_key(fi))
            if not ids:
                continue
            stored_id = ids.pop(0)
            patch = {k: fi.get(k) for k in _REPROCESS_FIELDS if fi.get(k) is not None}
            if not patch:
                continue
            uc.table("purchase_items").update(patch).eq("id", stored_id).execute()
            items_updated += 1

        # Backfill do cabeçalho (proveniência) quando faltante
        header_patch = {}
        if parsed.get("cnpj"):
            header_patch["cnpj"] = parsed["cnpj"]
        if parsed.get("payment_method"):
            header_patch["payment_method"] = parsed["payment_method"]
        if header_patch:
            uc.table("purchase_history").update(header_patch).eq("id", purchase_id).execute()
        purchases_touched += 1

    return {"receipts": len(receipts_data), "purchases": purchases_touched, "items_updated": items_updated}


@router.post("/reprocessar-historico")
@limiter.limit("2/minute")
async def reprocess_history(
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Re-aplica o parser/normalização atuais ao histórico do usuário a partir do HTML
    cru guardado (receipts_raw). Idempotente. Preserva edições manuais do usuário."""
    try:
        result = await run_in_threadpool(
            _reprocess_user_history, current_user.access_token, current_user.id
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Erro ao reprocessar histórico: {e}")
        raise HTTPException(status_code=500, detail="Erro ao reprocessar o histórico.")

    logger.info(
        f"♻️ Reprocessamento: {result['purchases']} compras, "
        f"{result['items_updated']} itens atualizados (user {current_user.id})."
    )
    return {
        "success": True,
        "mensagem": f"Reprocessamos {result['purchases']} nota(s) e atualizamos "
                    f"{result['items_updated']} item(ns).",
        **result,
    }

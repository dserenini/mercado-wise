"""Endpoint de upload/leitura de cupom fiscal (NFC-e)."""
import logging

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Request
from fastapi.concurrency import run_in_threadpool

from app.config import settings
from app.db import db, user_client
from app.dependencies import get_current_user, CurrentUser
from app.limiter import limiter
from app.services.ai_normalizer import AINormalizerService
from app.services.dedup import process_scraped_items, check_duplicate
from app.services.scrapers import extract_url_from_image, scrape_receipt

logger = logging.getLogger(__name__)
router = APIRouter()
ai_service = AINormalizerService()


def _persist_purchase(access_token, user_id, force, url_sefaz, mercado, total,
                      purchase_date, itens) -> dict:
    """Bloqueante (roda em threadpool): checa duplicata e grava sob RLS."""
    uc = user_client(access_token)
    if not uc:
        raise HTTPException(status_code=503, detail="Serviço de banco indisponível.")

    if not force:
        dup = check_duplicate(uc, user_id, url_sefaz, mercado, purchase_date, itens)
        if dup:
            return {"outcome": "duplicate", "layer": dup["layer"], "existing": dup["existing"]}

    purchase_payload = {
        "user_id": user_id,
        "supermarket_name": mercado,
        "total_amount": total,
        "nfc_url": url_sefaz,
    }
    if purchase_date:
        purchase_payload["purchase_date"] = purchase_date

    res = uc.table("purchase_history").insert(purchase_payload).execute()
    purchase_id = res.data[0].get("id")

    if itens:
        for item in itens:
            item["purchase_id"] = purchase_id
        uc.table("purchase_items").insert(itens).execute()

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

    # 5. Normalização (rede/BD global → threadpool)
    itens = await run_in_threadpool(process_scraped_items, db, itens_raw, ai_service)
    scraping_result["items"] = itens

    # 6. Persistência sob RLS (BD → threadpool)
    try:
        result = await run_in_threadpool(
            _persist_purchase, current_user.access_token, user_id, force,
            url_sefaz, mercado, total, purchase_date, itens,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Erro de Banco: {e}")
        raise HTTPException(status_code=500, detail="Erro ao salvar a nota. Tente novamente.")

    if result["outcome"] == "duplicate":
        existing = result["existing"]
        reason = "mesma URL da nota fiscal" if result["layer"] == "url" else "mesmo mercado, data e itens"
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

"""Endpoint de produto por GTIN (scan de gôndola).

A gravação da observação de preço é feita direto pelo frontend (Supabase, RLS),
seguindo o padrão do app. Aqui fica só a resolução do GTIN, que precisa do
servidor (proxy da Open Food Facts + cache global em gtin_catalog).
"""
import logging

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.concurrency import run_in_threadpool

from app.dependencies import get_current_user, CurrentUser
from app.limiter import limiter
from app.services.gtin import resolve_gtin, is_valid_gtin

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/produto/{gtin}")
@limiter.limit("30/minute")
async def get_produto(
    request: Request,
    gtin: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Resolve os metadados de um produto pelo código de barras (GTIN)."""
    if not is_valid_gtin(gtin):
        raise HTTPException(status_code=400, detail="Código de barras inválido.")

    result = await run_in_threadpool(resolve_gtin, gtin)
    if result is None:
        raise HTTPException(status_code=503, detail="Não foi possível consultar o produto agora.")

    return {
        "success": True,
        "found": bool(result.get("found")),
        "produto": {
            "gtin": gtin,
            "name": result.get("name"),
            "brand": result.get("brand"),
            "package_size": result.get("package_size"),
            "package_unit": result.get("package_unit"),
            "source": result.get("source"),
        },
    }

"""Pipeline de ingestão por FOTO: preprocess → Gemini (retry) → validadores → itens.

Devolve os itens já no formato que [`process_scraped_items`](../dedup.py) consome, para
reusar a normalização (dicionário/GTIN/Gemini) e a persistência sem atrito.
"""
from __future__ import annotations

import io
import logging
import time

from PIL import Image, ImageOps

from app.services.vision.extractor_gemini import GeminiExtractor
from app.services.vision.schema import ReceiptExtraction
from app.services.vision.validators import validate, ReceiptVerdict

logger = logging.getLogger(__name__)

# Lado maior enviado ao motor: equilíbrio entre legibilidade do EAN e payload/latência.
# O eval mostrou 22/22 EAN até 700px; 1300 dá folga e corta tokens de entrada vs 1600.
_MAX_SIDE = 1300
_RETRIES = 2


def preprocess(img_bytes: bytes) -> bytes:
    """Corrige orientação por EXIF e reduz para um tamanho que mantém os dígitos legíveis."""
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(img_bytes)))
    im.thumbnail((_MAX_SIDE, _MAX_SIDE), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=90)
    return buf.getvalue()


def extract_with_retry(img_bytes: bytes, extractor: GeminiExtractor | None = None) -> ReceiptExtraction:
    """Chama o motor de visão com retry/backoff — o free-tier tem falhas transitórias."""
    extractor = extractor or GeminiExtractor()
    last_err: Exception | None = None
    for attempt in range(1, _RETRIES + 1):
        try:
            ex = extractor.extract(img_bytes)
            if ex.itens:  # resposta plausível
                return ex
            last_err = RuntimeError("extração vazia")
        except Exception as e:
            last_err = e
            logger.warning(f"Tentativa {attempt}/{_RETRIES} de visão falhou: {e}")
        time.sleep(1.5 * attempt)
    raise RuntimeError(f"OCR de visão falhou após {_RETRIES} tentativas: {last_err}")


def to_scraped_items(extraction: ReceiptExtraction) -> list[dict]:
    """Converte itens da extração para o dict que a normalização/persistência esperam.

    A visão só EXTRAI (nome cru + EAN + preço). A normalização (nome/marca) é feita depois
    pela cascata por código em `process_scraped_items`: gtin_catalog → Open Food Facts →
    Gemini só p/ código novo. Assim cada EAN é traduzido uma vez e depois vem do cache.
    """
    return [
        {
            "product_name": it.descricao,
            "raw_name": it.descricao,
            "gtin": it.ean,                 # identidade universal cross-store
            "cprod": it.cod_interno,        # código de balança (pesáveis) — identidade por mercado
            "unit": it.unidade,
            "quantity": it.qtd if it.qtd is not None else 1.0,
            "unit_price": it.preco_unit if it.preco_unit is not None else 0.0,
            "total_price": it.preco_total if it.preco_total is not None else 0.0,
        }
        for it in extraction.itens
    ]


def run_photo_pipeline(img_bytes: bytes, extractor: GeminiExtractor | None = None) -> dict:
    """Orquestra a leitura de UMA foto. Não persiste — devolve tudo para o router decidir."""
    prepared = preprocess(img_bytes)
    extraction = extract_with_retry(prepared, extractor)
    verdict: ReceiptVerdict = validate(extraction)
    return {
        "extraction": extraction,
        "verdict": verdict,
        "items": to_scraped_items(extraction),
        "semaforo": verdict.traffic_light,
    }

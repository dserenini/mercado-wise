"""Extrator de visão via Gemini 2.5 Flash (multimodal). Reusa a stack `google-genai`
já usada na normalização ([`ai_normalizer.py`](../ai_normalizer.py)) — mesma chave, tem
free-tier. Candidato de menor esforço no bake-off."""
from __future__ import annotations

import json
import logging
import time

from google import genai
from google.genai import types

from app.config import settings
from app.services.vision.base import EXTRACTION_PROMPT
from app.services.vision.schema import ReceiptExtraction

logger = logging.getLogger(__name__)

_MODEL = "gemini-2.5-flash"
# Transcrição não precisa de raciocínio: desligar o "thinking" do 2.5-flash é o maior
# corte de latência isolado. 0 = desligado; suba um pouco se a acurácia cair em foto ruim.
_THINKING_BUDGET = 0


class GeminiExtractor:
    name = "gemini-2.5-flash"

    def __init__(self, model: str = _MODEL, thinking_budget: int = _THINKING_BUDGET):
        self.model = model
        self.thinking_budget = thinking_budget
        self.client = genai.Client(api_key=settings.gemini_api_key) if settings.gemini_api_key else None

    def is_configured(self) -> bool:
        return self.client is not None

    def extract(self, img_bytes: bytes, mime_type: str = "image/jpeg") -> ReceiptExtraction:
        if not self.client:
            raise RuntimeError("GEMINI_API_KEY não configurada.")

        t0 = time.perf_counter()
        response = self.client.models.generate_content(
            model=self.model,
            contents=[
                types.Part.from_bytes(data=img_bytes, mime_type=mime_type),
                EXTRACTION_PROMPT,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0,
                thinking_config=types.ThinkingConfig(thinking_budget=self.thinking_budget),
            ),
        )
        latency = time.perf_counter() - t0

        try:
            payload = json.loads(response.text)
        except (json.JSONDecodeError, TypeError) as e:
            logger.error(f"Gemini devolveu JSON inválido: {e}")
            payload = {"emitente": {}, "itens": [], "meta": {"eh_cupom": False}}

        extraction = ReceiptExtraction.from_payload(payload, engine=self.name)
        extraction.latency_s = round(latency, 2)
        return extraction

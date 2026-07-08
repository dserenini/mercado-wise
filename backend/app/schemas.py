"""Schemas Pydantic de request/response da API."""
from pydantic import BaseModel


class ExistingPurchase(BaseModel):
    id: str | None = None
    supermarket_name: str | None = None
    purchase_date: str | None = None
    total_amount: float | None = None


class UploadCupomResponse(BaseModel):
    """Resposta de /upload-cupom. Cobre os três casos: saved, duplicate e (implicitamente) erro."""
    success: bool
    status: str  # "saved" | "duplicate"
    mensagem: str
    # Dados extraídos da nota (estrutura flexível vinda do scraper)
    data: dict | None = None
    scraped_data: dict | None = None
    # Presente apenas quando status == "duplicate"
    existing: ExistingPurchase | None = None

"""Ponto de entrada da API Mercado Fácil (OCR/scrape/normalize)."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from app.config import settings
from app.limiter import limiter
from app.routers import cupom
from app.services.scrapers import reload_db_aliases

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Iniciando servidor — carregando aliases de supermercado do banco...")
    reload_db_aliases()
    yield


app = FastAPI(title="API IA Mercado Fácil - Motor Ocr", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(cupom.router)


@app.get("/")
def home():
    return {"status": "🤖 Servidor IA do Mercado Fácil Online"}

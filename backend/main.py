import os
import hashlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
import uvicorn

from database import db, user_client
from auth import get_current_user, CurrentUser
from services.scraper_mg import extract_url_from_image, scrape_sefaz_mg, reload_db_aliases
from services.ai_normalizer import AINormalizerService

# Configuração de Logs
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Config via ambiente ────────────────────────────────────────────────────
# Origens permitidas para CORS (separadas por vírgula). Sem "*" em produção.
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:8080").split(",") if o.strip()
]
# Tamanho máximo de upload (MB)
MAX_UPLOAD_MB = float(os.getenv("MAX_UPLOAD_MB", "10"))
MAX_UPLOAD_BYTES = int(MAX_UPLOAD_MB * 1024 * 1024)

ai_service = AINormalizerService()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Carrega aliases de supermercado do banco uma vez ao iniciar o servidor."""
    logger.info("🚀 Iniciando servidor — carregando aliases de supermercado do banco...")
    reload_db_aliases()
    yield


app = FastAPI(title="API IA Mercado Fácil - Motor Ocr", lifespan=lifespan)

# ── Rate limiting ──────────────────────────────────────────────────────────
def _rate_key(request: Request) -> str:
    """Chaveia por usuário (Authorization) quando disponível; senão pelo IP."""
    auth = request.headers.get("authorization")
    if auth:
        return hashlib.sha256(auth.encode()).hexdigest()
    return get_remote_address(request)


limiter = Limiter(key_func=_rate_key)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/")
def home():
    return {"status": "🤖 Servidor IA do Mercado Fácil Online"}


def compute_items_fingerprint(items: list[dict]) -> str:
    """Gera hash MD5 dos itens ordenados para comparação de duplicatas."""
    sorted_items = sorted(items, key=lambda x: x.get("product_name", "").upper())
    parts = [
        f"{i['product_name'].upper().strip()}:{round(i.get('quantity', 1), 2)}:{round(i.get('unit_price', 0), 2)}"
        for i in sorted_items
    ]
    return hashlib.md5("|".join(parts).encode()).hexdigest()


def process_scraped_items(db_client, raw_items: list[dict], ai: AINormalizerService) -> list[dict]:
    """Intercepta os itens crus, varre o BD e passa os desconhecidos pelo Gemini antes de salvar.

    Usa o client Service Role (db_client) porque product_dictionary é uma tabela GLOBAL,
    não pertencente a um usuário específico.
    """
    if not db_client or not raw_items:
        return raw_items

    unique_raw_names = list({it["product_name"] for it in raw_items})

    try:
        # CAMADA 1: Cache db
        res = db_client.table("product_dictionary").select("raw_name, normalized_name").in_("raw_name", unique_raw_names).execute()
        known_map = {r["raw_name"]: r for r in res.data} if res.data else {}

        unknown_names = [n for n in unique_raw_names if n not in known_map]

        ai_map = {}
        # CAMADA 2: IA
        if unknown_names and ai.is_configured():
            ai_map = ai.normalize_products_batch(unknown_names)

            if ai_map:
                new_entries = []
                for raw_str, data in ai_map.items():
                    new_entries.append({
                        "raw_name": raw_str,
                        "normalized_name": data["normalized_name"],
                        "unit": data.get("unit"),
                        "category": data.get("category", "Geral"),
                        "status": "pending",
                        "confidence_score": 1
                    })
                # Grava no banco e permite erro silently para não travar a compra
                try:
                    db_client.table("product_dictionary").insert(new_entries).execute()
                    logger.info(f"💾 {len(new_entries)} novos produtos adicionados ao dicionário (PENDING).")
                except Exception as e:
                    logger.error(f"Erro ao salvar novas traduções IA no BD: {e}")

        # SUBSTITUIÇÃO
        for item in raw_items:
            raw_name = item["product_name"]
            if raw_name in known_map:
                item["product_name"] = known_map[raw_name]["normalized_name"]
            elif raw_name in ai_map:
                item["product_name"] = ai_map[raw_name]["normalized_name"]

    except Exception as e:
        logger.error(f"Erro no pipeline de normalização de produtos: {e}")

    return raw_items


def check_duplicate(client, user_id: str, url_sefaz: str, mercado: str,
                    purchase_date: str | None, items: list[dict]) -> dict | None:
    """Verifica se a nota já foi cadastrada pelo usuário.

    Usa o client autenticado do usuário (RLS garante que só enxerga as próprias compras).

    Camadas de verificação:
      1. URL da NFC-e — identificador único e inequívoco da nota fiscal
      2. Supermercado + Data + Fingerprint dos itens — cobre casos de URL variável
    """
    if not client:
        return None

    try:
        # CAMADA 1: URL da NFC-e
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

        # CAMADA 2: Supermercado + Data + Fingerprint
        if purchase_date and items:
            res2 = (
                client.table("purchase_history")
                .select("id, supermarket_name, purchase_date, total_amount, purchase_items(product_name, quantity, unit_price)")
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


@app.post("/upload-cupom")
@limiter.limit("20/minute")
async def extract_receipt_data(
    request: Request,
    file: UploadFile = File(...),
    force_save: str = Form("false"),  # "true" = salvar mesmo sendo duplicata
    current_user: CurrentUser = Depends(get_current_user),
):
    user_id = current_user.id
    force = force_save.lower() == "true"
    logger.info(f"📸 Arquivo: {file.filename} | user: {user_id} | force: {force}")

    # 1. Validação de tipo
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="Ei, mande a foto do cupom!")

    # 1b. Rejeição rápida por tamanho (header) antes de ler o corpo
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Imagem muito grande (máx {MAX_UPLOAD_MB:.0f} MB).")

    # 2. Ler imagem (com teto de segurança)
    img_bytes = await file.read()
    logger.info(f"💾 Tamanho: {len(img_bytes) / 1024 / 1024:.2f} MB")
    if len(img_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Imagem muito grande (máx {MAX_UPLOAD_MB:.0f} MB).")
    if not img_bytes:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")

    # 3. Extrair URL do QR Code
    url_sefaz, layer_used = extract_url_from_image(img_bytes)
    if not url_sefaz:
        raise HTTPException(status_code=400, detail="Não foi possível ler a nota. Considere a Leitura por uma IA")
    logger.info(f"🔗 URL: {url_sefaz}")

    # 4. Scraping Sefaz (valida allowlist de domínio internamente — anti-SSRF)
    scraping_result = scrape_sefaz_mg(url_sefaz)
    if not scraping_result.get("success"):
        raise HTTPException(status_code=502, detail="Não foi possível ler os dados da nota na Sefaz.")

    mercado       = scraping_result.get("supermarket_name", "Desconhecido")
    total         = scraping_result.get("total_amount", 0.0)
    purchase_date = scraping_result.get("purchase_date")
    itens_raw     = scraping_result.get("items", [])

    # Pipeline de Normalização (DB global + Gemini AI) — usa Service Role só p/ dicionário
    itens = process_scraped_items(db, itens_raw, ai_service)
    scraping_result["items"] = itens

    # 5. Banco de Dados — escrita COMO o usuário (RLS ativa)
    uc = user_client(current_user.access_token)
    if not uc:
        raise HTTPException(status_code=503, detail="Serviço de banco indisponível.")

    try:
        # ── CHECK DE DUPLICATA ──────────────────────────────────────────────
        if not force:
            dup = check_duplicate(uc, user_id, url_sefaz, mercado, purchase_date, itens)
            if dup:
                existing = dup["existing"]
                reason   = "mesma URL da nota fiscal" if dup["layer"] == "url" else "mesmo mercado, data e itens"
                logger.info(f"🚫 Duplicata bloqueada ({reason}). Aguardando confirmação.")
                return {
                    "success":      False,
                    "status":       "duplicate",
                    "mensagem":     f"Esta nota já está no seu histórico ({reason}).",
                    "existing": {
                        "id":               existing.get("id"),
                        "supermarket_name": existing.get("supermarket_name"),
                        "purchase_date":    existing.get("purchase_date"),
                        "total_amount":     existing.get("total_amount"),
                    },
                    "scraped_data": scraping_result,
                }
        # ───────────────────────────────────────────────────────────────────

        # Payload da compra
        purchase_payload = {
            "user_id":          user_id,
            "supermarket_name": mercado,
            "total_amount":     total,
            "nfc_url":          url_sefaz,
        }
        if purchase_date:
            purchase_payload["purchase_date"] = purchase_date
            logger.info(f"📅 Data da nota: {purchase_date}")
        else:
            logger.warning("⚠️ Data não encontrada — banco usará data atual.")

        # Inserir compra
        res = uc.table("purchase_history").insert(purchase_payload).execute()
        purchase_id = res.data[0].get('id')
        logger.info(f"✅ Compra #{purchase_id} registrada{' (forçada)' if force else ''}.")

        # Inserir itens
        if itens:
            for item in itens:
                item["purchase_id"] = purchase_id
            uc.table("purchase_items").insert(itens).execute()
            logger.info(f"🛒 {len(itens)} itens inseridos.")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Erro de Banco: {e}")
        raise HTTPException(status_code=500, detail="Erro ao salvar a nota. Tente novamente.")

    return {
        "success":  True,
        "status":   "saved",
        "mensagem": f"Método({layer_used}) Lemos {len(itens)} produtos no valor de R$ {total:.2f} do {mercado} e salvamos!",
        "data":     scraping_result,
    }


if __name__ == "__main__":
    logger.info("🔥 Iniciando Servidor Python Mercado Fácil (Porta 8000)...")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

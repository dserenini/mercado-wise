from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import logging
import hashlib
from database import db
from services.scraper_mg import extract_url_from_image, scrape_sefaz_mg, reload_db_aliases

# Configuração de Logs
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="API IA Mercado Fácil - Motor Ocr")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def on_startup():
    """Carrega aliases de supermercado do banco uma vez ao iniciar o servidor."""
    logger.info("🚀 Iniciando servidor — carregando aliases de supermercado do banco...")
    reload_db_aliases()


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


def check_duplicate(user_id: str, url_sefaz: str, mercado: str,
                    purchase_date: str | None, items: list[dict]) -> dict | None:
    """Verifica se a nota já foi cadastrada pelo usuário.

    Camadas de verificação:
      1. URL da NFC-e — identificador único e inequívoco da nota fiscal
      2. Supermercado + Data + Fingerprint dos itens — cobre casos de URL variável
    """
    if not db:
        return None

    try:
        # CAMADA 1: URL da NFC-e
        res = (
            db.table("purchase_history")
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
                db.table("purchase_history")
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
async def extract_receipt_data(
    file: UploadFile = File(...),
    user_id: str = Form(None),
    force_save: str = Form("false"),  # "true" = salvar mesmo sendo duplicata
):
    force = force_save.lower() == "true"
    logger.info(f"📸 Arquivo: {file.filename} | user: {user_id} | force: {force}")

    # 1. Validação de tipo
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="Ei, mande a foto do cupom!")

    # 2. Ler imagem
    img_bytes = await file.read()
    logger.info(f"💾 Tamanho: {len(img_bytes) / 1024 / 1024:.2f} MB")

    # 3. Extrair URL do QR Code
    url_sefaz, layer_used = extract_url_from_image(img_bytes)
    if not url_sefaz:
        raise HTTPException(status_code=400, detail="Não foi possível ler a nota. Considere a Leitura por uma IA")
    logger.info(f"🔗 URL: {url_sefaz}")

    # 4. Scraping Sefaz
    scraping_result = scrape_sefaz_mg(url_sefaz)
    if not scraping_result.get("success"):
        raise HTTPException(status_code=500, detail=f"Falha ao ler dados na Nota: {scraping_result.get('error')}")

    mercado       = scraping_result.get("supermarket_name", "Desconhecido")
    total         = scraping_result.get("total_amount", 0.0)
    purchase_date = scraping_result.get("purchase_date")
    itens         = scraping_result.get("items", [])

    # 5. Banco de Dados
    try:
        if not db:
            raise ValueError("Banco não iniciado. Faltam chaves no .env.")
        if not user_id:
            raise ValueError("user_id não recebido do frontend.")

        # ── CHECK DE DUPLICATA ──────────────────────────────────────────────
        if not force:
            dup = check_duplicate(user_id, url_sefaz, mercado, purchase_date, itens)
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
        res = db.table("purchase_history").insert(purchase_payload).execute()
        purchase_id = res.data[0].get('id')
        logger.info(f"✅ Compra #{purchase_id} registrada{' (forçada)' if force else ''}.")

        # Inserir itens
        if itens:
            for item in itens:
                item["purchase_id"] = purchase_id
            db.table("purchase_items").insert(itens).execute()
            logger.info(f"🛒 {len(itens)} itens inseridos.")

    except Exception as e:
        logger.error(f"❌ Erro de Banco: {e}")
        raise HTTPException(status_code=500, detail=f"Erro no BD: {str(e)}")

    return {
        "success":  True,
        "status":   "saved",
        "mensagem": f"Método({layer_used}) Lemos {len(itens)} produtos no valor de R$ {total:.2f} do {mercado} e salvamos!",
        "data":     scraping_result,
    }


if __name__ == "__main__":
    logger.info("🔥 Iniciando Servidor Python Mercado Fácil (Porta 8000)...")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import logging
from database import db
from services.scraper_mg import extract_url_from_image, scrape_sefaz_mg, reload_db_aliases

# Configuração de Logs
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="API IA Mercado Fácil - Motor Ocr")

# Permitir o Frontend do React acessar o servidor
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Funciona livremente via localhost
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


@app.post("/upload-cupom")
async def extract_receipt_data(
    file: UploadFile = File(...),
    user_id: str = Form(None)
):
    logger.info(f"📸 Recebemos uma nota! Arquivo: {file.filename} do usuário: {user_id}")
    
    # 1. Validação do tipo de arquivo
    if not file.content_type.startswith('image/'):
        logger.warning("Tentativa falha de upload: não era imagem.")
        raise HTTPException(status_code=400, detail="Ei, mande a foto do cupom!")
        
    # 2. Lendo o arquivo para a memória do Python (onde a IA o assumirá futuramente)
    img_bytes = await file.read()
    tamanho_mb = len(img_bytes) / (1024 * 1024)
    logger.info(f"💾 Peso do cupom analisado: {tamanho_mb:.2f} MB")
    
    # Extrair URL via QR Code
    url_sefaz, layer_used = extract_url_from_image(img_bytes)
    if not url_sefaz:
        raise HTTPException(status_code=400, detail="Não foi possível ler a nota. Considere a Leitura por uma IA")
        
    logger.info(f"🔗 URL Extraída do QR Code: {url_sefaz}")
    
    # Extrair dados Web Scraping (Sefaz)
    scraping_result = scrape_sefaz_mg(url_sefaz)
    if not scraping_result.get("success"):
        raise HTTPException(status_code=500, detail=f"Falha ao ler dados na Nota (Sefaz): {scraping_result.get('error')}")
        
    mercado = scraping_result.get("supermarket_name", "Desconhecido")
    total = scraping_result.get("total_amount", 0.0)
    purchase_date = scraping_result.get("purchase_date")  # "YYYY-MM-DD" ou None

    # 3. Integração com Banco de Dados (Bypass RLS com Service Key)
    try:
        if not db:
            raise ValueError("O banco (database.db) não pôde ser iniciado. Faltam chaves de administrador no .env.")
        if not user_id:
            raise ValueError("O usuário não foi detectado (Frontend não mandou user_id).")

        # Montar payload da compra
        purchase_payload = {
            "user_id": user_id,
            "supermarket_name": mercado,
            "total_amount": total,
            "nfc_url": url_sefaz,
        }
        # Só envia purchase_date se conseguir extrair da nota (senão o banco usa default)
        if purchase_date:
            purchase_payload["purchase_date"] = purchase_date
            logger.info(f"📅 Salvando com data da nota: {purchase_date}")
        else:
            logger.warning("⚠️ Data da nota não encontrada — banco usará data atual como fallback.")

        # Inserir o TICKET/COMPRA
        res = db.table("purchase_history").insert(purchase_payload).execute()
        
        purchase_id = res.data[0].get('id')
        logger.info(f"✅ Gravação RLS bypassada: Compra #{purchase_id} registrada.")
        
        # Inserir a Lista de Produtos
        itens_raspados = scraping_result.get("items", [])
        if itens_raspados:
            for item in itens_raspados:
                item["purchase_id"] = purchase_id
            
            # Insere todo o array batelado no Supabase
            db.table("purchase_items").insert(itens_raspados).execute()
            logger.info(f"🛒 {len(itens_raspados)} produtos inseridos para a compra #{purchase_id}.")
        
    except Exception as e:
        logger.error(f"❌ Erro de Banco: {e}")
        raise HTTPException(status_code=500, detail=f"Erro no BD (A tabela purchase_items existe?): {str(e)}")
    
    # FASE 2: Mensagem de Retorno Modificada
    qtd_produtos = len(scraping_result.get("items", []))
    
    return {
        "success": True,
        "mensagem": f"Método({layer_used}) Lemos {qtd_produtos} produtos no valor de R$ {total:.2f} do {mercado} e salvamos os itens!",
        "data": scraping_result
    }

if __name__ == "__main__":
    logger.info("🔥 Iniciando Servidor Python Mercado Fácil (Porta 8000)...")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

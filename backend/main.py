from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import logging
from database import db

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
    
    # 3. Integração com Banco de Dados (Bypass RLS com Service Key)
    try:
        if not db:
            raise ValueError("O banco (database.db) não pôde ser iniciado. Faltam chaves de administrador no .env.")
        if not user_id:
            raise ValueError("O usuário não foi detectado (Frontend não mandou user_id).")
            
        res = db.table("purchase_history").insert({
            "user_id": user_id,
            "supermarket_name": "Mercado Falso (Via Microserviço Python)",
            "total_amount": 99.99
        }).execute()
        
        logger.info(f"✅ Gravação RLS bypassada com sucesso: id {res.data[0].get('id')}")
        
    except Exception as e:
        logger.error(f"❌ Erro de Banco: {e}")
        raise HTTPException(status_code=500, detail=f"Erro de Conexão ou Permissão no DB: {str(e)}")
    
    # FASE 2: Mensagem de Retorno Modificada
    return {
        "success": True,
        "mensagem": f"O Python recebeu a imagem e criou o 'Mercado Falso' na aba de Histórico remotamente!"
    }

if __name__ == "__main__":
    logger.info("🔥 Iniciando Servidor Python Mercado Fácil (Porta 8000)...")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

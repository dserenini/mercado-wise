from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import logging

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
async def extract_receipt_data(file: UploadFile = File(...)):
    logger.info(f"📸 Recebemos uma nota! Arquivo: {file.filename}")
    
    # 1. Validação do tipo de arquivo
    if not file.content_type.startswith('image/'):
        logger.warning("Tentativa falha de upload: não era imagem.")
        raise HTTPException(status_code=400, detail="Ei, mande a foto do cupom!")
        
    # 2. Lendo o arquivo para a memória do Python (onde a IA o assumirá futuramente)
    img_bytes = await file.read()
    tamanho_mb = len(img_bytes) / (1024 * 1024)
    logger.info(f"💾 Peso do cupom analisado: {tamanho_mb:.2f} MB")
    
    # FASE 1: Devolver OK provando que chegamos aqui
    return {
        "success": True,
        "mensagem": f"O Python recebeu a foto '{file.filename}' com {tamanho_mb:.2f} MB. A Fase 1 foi um sucesso absoluto!"
    }

if __name__ == "__main__":
    logger.info("🔥 Iniciando Servidor Python Mercado Fácil (Porta 8000)...")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

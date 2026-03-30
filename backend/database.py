import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Como o servidor roda na pasta backend, o .env está um nível acima
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path)

# A URL é idêntica à do React
SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL")
# ATENÇÃO: Usamos a Service Role Key (Chave Mestra) para o Python dar bypass na segurança RLS.
# Isso permite que ele crie históricos de compras se passando pelo usuário.
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

def init_db() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError(
            "⚠️ ERRO DE AUTENTICAÇÃO: 'VITE_SUPABASE_URL' ou 'SUPABASE_SERVICE_ROLE_KEY' "
            "não encontrados no arquivo .env da raiz do projeto!"
        )
    return create_client(SUPABASE_URL, SUPABASE_KEY)

# Instância única global do banco para o Python
try:
    db = init_db()
except Exception as e:
    db = None
    print(e)

import os
import logging
from supabase import create_client, Client
from dotenv import load_dotenv

# Como o servidor roda na pasta backend, o .env está um nível acima
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path)

logger = logging.getLogger(__name__)

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


def load_supermarket_aliases() -> list[dict]:
    """Carrega todos os aliases do banco e retorna ordenados por prioridade (menor = primeiro).

    Retorna lista de dicts: [{"alias": "...", "display_name": "..."}, ...]
    Em caso de erro (banco indisponível), retorna lista vazia — o scraper usará o fallback local.
    """
    if not db:
        logger.warning("⚠️ Banco indisponível — aliases de supermercado não carregados do BD.")
        return []
    try:
        res = (
            db.table("supermarket_aliases")
            .select("alias, display_name, priority")
            .order("priority", desc=False)
            .execute()
        )
        aliases = res.data or []
        logger.info(f"🏪 {len(aliases)} alias(es) de supermercado carregados do banco.")
        return aliases
    except Exception as e:
        logger.error(f"❌ Erro ao carregar aliases de supermercado: {e}")
        return []

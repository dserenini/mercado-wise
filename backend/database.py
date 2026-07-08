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
# Chave pública (anon/publishable) — usada para VALIDAR o JWT do usuário e para
# escrever "como o usuário" respeitando a RLS. É a mesma chave que o frontend usa.
SUPABASE_ANON_KEY = (
    os.environ.get("SUPABASE_ANON_KEY")
    or os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY")
)
# ATENÇÃO: A Service Role Key (Chave Mestra) dá bypass na RLS. Reservada EXCLUSIVAMENTE
# para tabelas globais que não pertencem a um usuário (ex.: product_dictionary,
# supermarket_aliases). NUNCA deve ser usada para gravar dados em nome de um usuário.
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


def init_db() -> Client:
    """Client com Service Role — apenas para tabelas globais (dicionário, aliases)."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError(
            "⚠️ ERRO DE AUTENTICAÇÃO: 'VITE_SUPABASE_URL' ou 'SUPABASE_SERVICE_ROLE_KEY' "
            "não encontrados no arquivo .env da raiz do projeto!"
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# Instância única global do banco (Service Role) para tabelas globais
try:
    db = init_db()
except Exception as e:
    db = None
    print(e)


# Client leve com a chave pública, usado só para validar tokens de usuário.
try:
    _auth_client: Client | None = (
        create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        if SUPABASE_URL and SUPABASE_ANON_KEY
        else None
    )
except Exception as e:
    _auth_client = None
    logger.error(f"Falha ao criar client de autenticação: {e}")


def validate_token(access_token: str):
    """Valida um JWT de usuário junto ao Supabase Auth e retorna o objeto User (ou None).

    Fonte de verdade do 'user_id' — nunca confiar num id vindo do corpo da requisição.
    """
    if not _auth_client or not access_token:
        return None
    try:
        res = _auth_client.auth.get_user(access_token)
        return res.user if res and res.user else None
    except Exception as e:
        logger.warning(f"Token de usuário inválido/expirado: {e}")
        return None


def user_client(access_token: str) -> Client | None:
    """Cria um client Supabase autenticado COMO o usuário (chave pública + JWT).

    Todas as escritas em tabelas que pertencem a usuários (purchase_history,
    purchase_items, etc.) devem passar por aqui, de forma que a RLS continue valendo.
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY or not access_token:
        return None
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    # Anexa o JWT do usuário às chamadas PostgREST → RLS avalia auth.uid() corretamente
    client.postgrest.auth(access_token)
    return client


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
            .select("alias, display_name, priority, cnpj_base")
            .order("priority", desc=False)
            .execute()
        )
        aliases = res.data or []
        logger.info(f"🏪 {len(aliases)} alias(es) de supermercado carregados do banco.")
        return aliases
    except Exception as e:
        logger.error(f"❌ Erro ao carregar aliases de supermercado: {e}")
        return []

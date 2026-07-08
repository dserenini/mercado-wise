"""Clients Supabase e acesso ao banco.

Regra de ouro: a Service Role dá bypass de RLS e é reservada EXCLUSIVAMENTE a
tabelas globais (product_dictionary, supermarket_aliases). Dados de usuário são
escritos via `user_client`, que respeita a RLS.
"""
import logging

from supabase import create_client, Client

from app.config import settings

logger = logging.getLogger(__name__)


def _init_service_client() -> Client | None:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        logger.error(
            "⚠️ SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes — banco global indisponível."
        )
        return None
    try:
        return create_client(settings.supabase_url, settings.supabase_service_role_key)
    except Exception as e:  # pragma: no cover
        logger.error(f"Falha ao criar client service_role: {e}")
        return None


def _init_auth_client() -> Client | None:
    if not settings.supabase_url or not settings.supabase_anon_key:
        return None
    try:
        return create_client(settings.supabase_url, settings.supabase_anon_key)
    except Exception as e:  # pragma: no cover
        logger.error(f"Falha ao criar client de autenticação: {e}")
        return None


# Client global (Service Role) — só para tabelas globais
db: Client | None = _init_service_client()
# Client leve (chave pública) — só para validar tokens
_auth_client: Client | None = _init_auth_client()


def validate_token(access_token: str):
    """Valida um JWT junto ao Supabase Auth e retorna o User (ou None). Fonte de verdade do user_id."""
    if not _auth_client or not access_token:
        return None
    try:
        res = _auth_client.auth.get_user(access_token)
        return res.user if res and res.user else None
    except Exception as e:
        logger.warning(f"Token de usuário inválido/expirado: {e}")
        return None


def user_client(access_token: str) -> Client | None:
    """Client autenticado COMO o usuário (chave pública + JWT) — respeita a RLS."""
    if not settings.supabase_url or not settings.supabase_anon_key or not access_token:
        return None
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(access_token)
    return client


def load_supermarket_aliases() -> list[dict]:
    """Aliases de supermercado do banco, ordenados por prioridade. Lista vazia se indisponível."""
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

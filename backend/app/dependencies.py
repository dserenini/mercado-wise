"""Dependencies FastAPI — autenticação por JWT do Supabase.

O 'user_id' NUNCA vem do corpo da requisição — é derivado do token validado.
"""
import logging

from fastapi import Header, HTTPException, status

from app.db import validate_token

logger = logging.getLogger(__name__)


class CurrentUser:
    """Usuário autenticado + o access token cru (necessário para escrever sob RLS)."""

    def __init__(self, user_id: str, access_token: str):
        self.id = user_id
        self.access_token = access_token


async def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticação necessária.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split(" ", 1)[1].strip()
    user = validate_token(token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sessão inválida ou expirada. Faça login novamente.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return CurrentUser(user_id=user.id, access_token=token)

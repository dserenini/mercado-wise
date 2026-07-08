"""Rate limiter compartilhado (slowapi)."""
import hashlib

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _rate_key(request: Request) -> str:
    """Chaveia por usuário (Authorization) quando disponível; senão pelo IP."""
    auth = request.headers.get("authorization")
    if auth:
        return hashlib.sha256(auth.encode()).hexdigest()
    return get_remote_address(request)


limiter = Limiter(key_func=_rate_key)

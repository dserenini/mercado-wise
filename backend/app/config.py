"""Configuração central da aplicação (12-factor: tudo vem do ambiente)."""
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# .env fica na raiz do repositório (dois níveis acima de app/config.py).
# Em produção (Docker) as variáveis vêm do ambiente do container — o .env é ignorado.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore"
    )

    supabase_url: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_URL", "VITE_SUPABASE_URL"),
    )
    # Chave pública (anon/publishable) — valida JWT e escreve sob RLS
    supabase_anon_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"),
    )
    # Chave mestra — apenas tabelas globais (nunca escrita em nome do usuário)
    supabase_service_role_key: str | None = Field(
        default=None, validation_alias=AliasChoices("SUPABASE_SERVICE_ROLE_KEY")
    )
    gemini_api_key: str | None = Field(
        default=None, validation_alias=AliasChoices("GEMINI_API_KEY")
    )

    allowed_origins: str = Field(
        default="http://localhost:8080", validation_alias=AliasChoices("ALLOWED_ORIGINS")
    )
    allowed_sefaz_domains: str = Field(
        default="fazenda.mg.gov.br,sefaz.mg.gov.br",
        validation_alias=AliasChoices("ALLOWED_SEFAZ_DOMAINS"),
    )
    max_upload_mb: float = Field(
        default=10.0, validation_alias=AliasChoices("MAX_UPLOAD_MB")
    )

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def sefaz_domains(self) -> tuple[str, ...]:
        return tuple(d.strip().lower() for d in self.allowed_sefaz_domains.split(",") if d.strip())

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)


settings = Settings()

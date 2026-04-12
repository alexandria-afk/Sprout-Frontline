from functools import lru_cache
from pathlib import Path
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).parent / ".env"
load_dotenv(_ENV_FILE, override=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    # ── Auth (Keycloak) ───────────────────────────────────────────────────────
    keycloak_url: str = "http://localhost:56144"
    keycloak_realm: str = "sprout"
    # Admin API credentials — master realm admin-cli client (dev defaults)
    keycloak_admin_client_id: str = "admin-cli"
    keycloak_admin_username: str = "admin"
    keycloak_admin_password: str = "admin"

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = ""

    # ── Storage (Azure Blob / Azurite) ────────────────────────────────────────
    azure_storage_connection_string: str = (
        "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;"
        "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tPZ/"
        "RwAAAAAAAAAAAAAAAAAAAAAAAAA==;"
        "BlobEndpoint=http://127.0.0.1:56008/devstoreaccount1;"
    )
    azure_storage_account_name: str = "devstoreaccount1"

    # ── Backend ───────────────────────────────────────────────────────────────
    backend_secret_key: str = "dev-secret-change-me"
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://0.0.0.0:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://0.0.0.0:3001",
        "http://127.0.0.1:3001",
    ]
    environment: str = "development"
    rate_limit_per_minute: int = 60
    frontend_url: str = "http://localhost:3000"

    # ── External services ─────────────────────────────────────────────────────
    anthropic_api_key: str = ""
    fcm_server_key: str = ""
    firebase_project_id: str = ""
    resend_api_key: str = ""
    resend_from_email: str = "noreply@yourdomain.com"

    # ── Supabase (kept for backward compat during migration — remove after Phase 4) ──
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

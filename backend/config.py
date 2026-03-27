from functools import lru_cache
from pathlib import Path
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).parent / ".env"
load_dotenv(_ENV_FILE, override=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    database_url: str = ""
    backend_secret_key: str = "dev-secret-change-me"
    allowed_origins: list[str] = ["http://localhost:3000"]
    environment: str = "development"
    rate_limit_per_minute: int = 60
    anthropic_api_key: str = ""
    frontend_url: str = "http://localhost:3000"
    # Phase 3 — optional until fully configured
    fcm_server_key: str = ""
    firebase_project_id: str = ""
    resend_api_key: str = ""
    resend_from_email: str = "noreply@yourdomain.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

import os
from functools import lru_cache
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_ENV: str = "production"

    # Database configuration
    DATABASE_URL: str = "postgresql+psycopg://survey_user:change_me@localhost:5432/ovarian_survey"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30

    # Security & Auth
    SECRET_KEY: str = "CHANGE_ME_GENERATE_A_VERY_LONG_SECURE_SECRET_FOR_PRODUCTION_32_BYTES"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 720  # 12 hours
    ADMIN_COOKIE_NAME: str = "ovarian_admin_token"

    # Admin bootstrap credentials
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "ChangeMeAdmin2026!"

    # Uvicorn workers
    WEB_CONCURRENCY: int = 4

    # CORS
    CORS_ORIGINS: str = "*"

    # Production controls
    ENABLE_DOCS: bool = True
    SEED_DEMO_DATA: bool = False

    # Form definition path
    DEFAULT_FORM_FILE: str = "form-definitions/ovarian-pathology-v1.json"

    # Real-time Google Sheets Webhook integration (Optional)
    GOOGLE_SHEETS_WEBHOOK_URL: str | None = None
    GOOGLE_SHEETS_SPREADSHEET_ID: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def cors_origins_list(self) -> List[str]:
        if self.CORS_ORIGINS == "*":
            return ["*"]
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


@lru_cache()
def get_settings() -> Settings:
    return Settings()

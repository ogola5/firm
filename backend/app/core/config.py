"""Environment-based configuration.

Every value can be overridden with an environment variable of the same name
(upper-case). Defaults are for the synthetic demonstration environment only.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # PostgreSQL is the target database. SQLite remains supported for fast tests.
    database_url: str = "postgresql+psycopg://kpc:kpc-demo@localhost:5433/kpc"
    jwt_secret: str = "synthetic-demo-only-change-in-production"
    jwt_lifetime_hours: int = 12
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    attachment_storage_dir: Path = BACKEND_ROOT / "storage" / "attachments"
    max_attachment_bytes: int = 10 * 1024 * 1024
    allowed_attachment_types: dict[str, str] = {
        ".csv": "text/csv",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".json": "application/json",
        ".log": "text/plain",
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".txt": "text/plain",
        ".webp": "image/webp",
    }

    # Periods and weekly/monthly buckets are cut in this time zone.
    reporting_timezone: str = "Africa/Nairobi"
    # Similar-fault score weights: equipment, symptom, category, relevance (METRICS.md).
    similarity_weights: tuple[float, float, float, float] = (0.40, 0.25, 0.20, 0.15)

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


settings = Settings()

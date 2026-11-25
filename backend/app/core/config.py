"""Environment-based configuration.

Every value can be overridden with an environment variable of the same name
(upper-case). Defaults are for the synthetic demonstration environment only.
"""
from __future__ import annotations

from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # PostgreSQL is the target database. SQLite remains supported for fast tests.
    database_url: str = "postgresql+psycopg://kpc:kpc-demo@localhost:5433/kpc"
    jwt_secret: str = "synthetic-demo-only-change-in-production"
    jwt_lifetime_hours: int = 12
    # Comma-separated in the environment: "https://a.example,https://b.example" (a JSON list also works).
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, value: str) -> str:
        """Hosts such as Render give postgres:// or postgresql:// URLs; SQLAlchemy needs the psycopg driver named."""
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix):]
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value):
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                import json
                return json.loads(text)
            return [item.strip().rstrip("/") for item in text.split(",") if item.strip()]
        return value

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

    # Accounts: only these email domains may enrol or sign in (exact match, no sub-domains).
    allowed_email_domains: list[str] = ["kpc.co.ke"]
    # The prototype never sends real email; messages go to the on-screen demo mailbox.
    # Set DEMO_MAILBOX=false in any real deployment (and connect a mail service first).
    demo_mailbox: bool = True
    email_code_minutes: int = 15
    email_code_attempts: int = 5
    email_codes_per_hour: int = 5
    login_attempts_before_lock: int = 5
    login_lock_minutes: int = 15
    password_min_length: int = 10

    # Periodic reports: financial year starts in this month (KPC: July to June).
    financial_year_start_month: int = 7
    # Scheduled emails go out at this local hour (weekly on Mondays, monthly on the 1st, yearly on FY start).
    report_send_hour: int = 7
    # Check for due reports in the background while the API runs (the CLI `send-reports` does the same).
    report_scheduler: bool = True
    # Where links in emails point.
    app_url: str = "http://localhost:5173"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


settings = Settings()

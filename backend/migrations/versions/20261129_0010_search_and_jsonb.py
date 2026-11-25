"""search (pg_trgm) and report answers as JSONB

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-29 09:00:00

PostgreSQL only; SQLite (tests) keeps a text column and the app falls back to simpler matching.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    # Fuzzy matching (typos, shorthand). Trusted extension since PostgreSQL 13; if a host refuses it,
    # carry on: search then uses full-text matching only (app/services/text_search.py checks at runtime).
    try:
        with bind.begin_nested():
            bind.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    except Exception:  # noqa: BLE001 - optional capability
        pass
    # The reporter's follow-up answers become queryable JSON, indexed for "answers contain ..." filters.
    op.execute("ALTER TABLE faults ALTER COLUMN report_details DROP DEFAULT")
    op.execute("ALTER TABLE faults ALTER COLUMN report_details TYPE JSONB "
               "USING COALESCE(NULLIF(report_details, ''), '{}')::jsonb")
    op.execute("ALTER TABLE faults ALTER COLUMN report_details SET DEFAULT '{}'::jsonb")
    op.execute("CREATE INDEX IF NOT EXISTS ix_faults_report_details ON faults USING GIN (report_details jsonb_path_ops)")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_faults_report_details")
    op.execute("ALTER TABLE faults ALTER COLUMN report_details DROP DEFAULT")
    op.execute("ALTER TABLE faults ALTER COLUMN report_details TYPE TEXT USING report_details::text")
    op.execute("ALTER TABLE faults ALTER COLUMN report_details SET DEFAULT '{}'")

"""admin console: rules and switches changed in the app; the developer / owner flag

Revision ID: 0014
Revises: 0013
Create Date: 2026-12-04 09:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'app_settings',
        sa.Column('key', sa.String(), primary_key=True),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('updated_by_id', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('developer', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.drop_column('developer')
    op.drop_table('app_settings')

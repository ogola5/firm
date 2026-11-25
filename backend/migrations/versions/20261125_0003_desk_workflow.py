"""desk workflow: equipment aliases, observation time, back-in-service time

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-25 09:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('equipment') as batch:
        batch.add_column(sa.Column('aliases', sa.Text(), nullable=False, server_default=''))
    with op.batch_alter_table('faults') as batch:
        batch.add_column(sa.Column('observed_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('seen_via', sa.String(), nullable=False, server_default=''))
    with op.batch_alter_table('fault_assignments') as batch:
        batch.add_column(sa.Column('back_in_service_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('fault_assignments') as batch:
        batch.drop_column('back_in_service_at')
    with op.batch_alter_table('faults') as batch:
        batch.drop_column('seen_via')
        batch.drop_column('observed_at')
    with op.batch_alter_table('equipment') as batch:
        batch.drop_column('aliases')

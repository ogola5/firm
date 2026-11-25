"""knowledge owners per equipment type

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-28 09:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # One named person (a Chief Technician or Senior Engineer) keeps each equipment type's knowledge current.
    op.create_table(
        'equipment_type_owners',
        sa.Column('equipment_type', sa.String(), primary_key=True),
        sa.Column('owner_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('assigned_by_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('assigned_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('equipment_type_owners')

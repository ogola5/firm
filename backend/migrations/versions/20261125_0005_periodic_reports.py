"""periodic reports: email choices and a delivery log (so nothing is sent twice)

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-25 18:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'report_subscriptions',
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), primary_key=True),
        sa.Column('kind', sa.String(), primary_key=True),  # week, month, year
        sa.Column('enabled', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        'report_deliveries',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('period_key', sa.String(), nullable=False),
        sa.Column('recipient_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('scope', sa.String(), nullable=False),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('kind', 'period_key', 'recipient_id', name='uq_report_delivery'),
    )


def downgrade() -> None:
    op.drop_table('report_deliveries')
    op.drop_table('report_subscriptions')

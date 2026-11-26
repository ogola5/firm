"""in-app notifications; a change reason on each procedure version

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-30 09:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'notifications',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        # fault, work, review, escalation, knowledge, recognition
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False, server_default=''),
        sa.Column('link', sa.String(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_notifications_user_created', 'notifications', ['user_id', 'created_at'])
    with op.batch_alter_table('procedure_updates') as batch:
        # Why this version differs from the one before (required for revisions and improvements).
        batch.add_column(sa.Column('change_reason', sa.Text(), nullable=False, server_default=''))


def downgrade() -> None:
    with op.batch_alter_table('procedure_updates') as batch:
        batch.drop_column('change_reason')
    op.drop_index('ix_notifications_user_created', table_name='notifications')
    op.drop_table('notifications')

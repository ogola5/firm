"""systems (related equipment, legacy system pages), their change history; tools on procedures

Revision ID: 0012
Revises: 0011
Create Date: 2026-12-01 09:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A system: equipment that works together (e.g. Line 4 pump A with its drive, lube-oil panel,
    # vibration monitor and RTU). Its page holds what people know about the whole, especially legacy ones.
    op.create_table(
        'systems',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False, unique=True),
        sa.Column('station', sa.String(), nullable=False, server_default=''),
        sa.Column('legacy', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('how_it_connects', sa.Text(), nullable=False, server_default=''),
        sa.Column('known_limitations', sa.Text(), nullable=False, server_default=''),
        sa.Column('updated_by_id', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        'system_changes',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('system_id', sa.String(), sa.ForeignKey('systems.id'), nullable=False, index=True),
        sa.Column('changed_on', sa.Date(), nullable=True),
        sa.Column('what_changed', sa.Text(), nullable=False),
        sa.Column('recorded_by_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    with op.batch_alter_table('equipment') as batch:
        batch.add_column(sa.Column('system_id', sa.String(), nullable=True))
    with op.batch_alter_table('procedure_updates') as batch:
        batch.add_column(sa.Column('tools_materials', sa.Text(), nullable=False, server_default=''))


def downgrade() -> None:
    with op.batch_alter_table('procedure_updates') as batch:
        batch.drop_column('tools_materials')
    with op.batch_alter_table('equipment') as batch:
        batch.drop_column('system_id')
    op.drop_table('system_changes')
    op.drop_table('systems')

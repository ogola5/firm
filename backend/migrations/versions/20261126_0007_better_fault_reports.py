"""better fault reports: safety hazard flag, structured answers, call-back number

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-26 15:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('faults') as batch:
        # Someone or something at risk (product leak, smoke, spill): Critical and top of every queue.
        batch.add_column(sa.Column('safety_hazard', sa.Integer(), nullable=False, server_default='0'))
        # The reporter's answers to the follow-up questions, as JSON (kept for analysis).
        batch.add_column(sa.Column('report_details', sa.Text(), nullable=False, server_default='{}'))
        # How to reach the person who reported it (extension, radio channel…).
        batch.add_column(sa.Column('callback', sa.String(), nullable=False, server_default=''))


def downgrade() -> None:
    with op.batch_alter_table('faults') as batch:
        batch.drop_column('callback')
        batch.drop_column('report_details')
        batch.drop_column('safety_hazard')

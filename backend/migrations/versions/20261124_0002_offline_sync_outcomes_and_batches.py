"""offline sync outcomes and batches

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-24 21:36:33.888352
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'sync_batches',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('actor_id', sa.String(), nullable=False),
        sa.Column('device_id', sa.String(), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('event_count', sa.Integer(), nullable=False),
        sa.Column('applied_count', sa.Integer(), nullable=False),
        sa.Column('conflict_count', sa.Integer(), nullable=False),
        sa.Column('rejected_count', sa.Integer(), nullable=False),
        sa.Column('duplicate_count', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name='fk_sync_batches_actor_id_users'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_sync_batches_actor_id'), 'sync_batches', ['actor_id'], unique=False)
    op.create_index(op.f('ix_sync_batches_received_at'), 'sync_batches', ['received_at'], unique=False)

    # Events stored by the earlier endpoint were recorded but never applied.
    with op.batch_alter_table('sync_events') as batch:
        batch.add_column(sa.Column('batch_id', sa.String(), nullable=True))
        batch.add_column(sa.Column('device_id', sa.String(), nullable=False, server_default=''))
        batch.add_column(sa.Column('sequence_number', sa.Integer(), nullable=False, server_default='0'))
        batch.add_column(sa.Column('base_status', sa.String(), nullable=True))
        batch.add_column(sa.Column('status', sa.String(), nullable=False, server_default='LEGACY_RECORDED'))
        batch.add_column(sa.Column('status_code', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('detail', sa.Text(), nullable=False, server_default=''))
        batch.add_column(sa.Column('result', sa.Text(), nullable=False, server_default='{}'))
        batch.add_column(sa.Column('applied_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('resolved_by_id', sa.String(), nullable=True))
        batch.add_column(sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('resolution_note', sa.Text(), nullable=False, server_default=''))
        batch.create_index('ix_sync_events_actor_id', ['actor_id'], unique=False)
        batch.create_index('ix_sync_events_batch_id', ['batch_id'], unique=False)
        batch.create_index('ix_sync_events_status', ['status'], unique=False)
        batch.create_foreign_key('fk_sync_events_batch_id_sync_batches', 'sync_batches', ['batch_id'], ['id'])
        batch.create_foreign_key('fk_sync_events_resolved_by_id_users', 'users', ['resolved_by_id'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('sync_events') as batch:
        batch.drop_constraint('fk_sync_events_resolved_by_id_users', type_='foreignkey')
        batch.drop_constraint('fk_sync_events_batch_id_sync_batches', type_='foreignkey')
        batch.drop_index('ix_sync_events_status')
        batch.drop_index('ix_sync_events_batch_id')
        batch.drop_index('ix_sync_events_actor_id')
        for column in (
            'resolution_note', 'resolved_at', 'resolved_by_id', 'applied_at', 'result', 'detail',
            'status_code', 'status', 'base_status', 'sequence_number', 'device_id', 'batch_id',
        ):
            batch.drop_column(column)
    op.drop_index(op.f('ix_sync_batches_received_at'), table_name='sync_batches')
    op.drop_index(op.f('ix_sync_batches_actor_id'), table_name='sync_batches')
    op.drop_table('sync_batches')

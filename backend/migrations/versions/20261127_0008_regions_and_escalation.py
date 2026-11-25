"""regions (Western, Nairobi, Coast) and escalation to the regional SE and the section CE

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-27 09:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None

# Illustrative: which region each demonstration station belongs to.
STATION_REGIONS = {"PS01": "Coast", "PS02": "Nairobi", "PS04": "Nairobi", "DEPOT01": "Western"}
REGIONAL_ROLES = ("technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer")


def upgrade() -> None:
    with op.batch_alter_table('users') as batch:
        # Regional staff (ST/PT/CT/AE/E/SE) work in one region; CE and company-wide roles have none.
        batch.add_column(sa.Column('region', sa.String(), nullable=False, server_default=''))
        batch.add_column(sa.Column('requested_region', sa.String(), nullable=False, server_default=''))
    with op.batch_alter_table('equipment') as batch:
        batch.add_column(sa.Column('region', sa.String(), nullable=False, server_default=''))
    with op.batch_alter_table('faults') as batch:
        # 0: with the Chief Technician; 1: with the regional Senior Engineer; 2: with the section Chief Engineer.
        batch.add_column(sa.Column('escalation_level', sa.Integer(), nullable=False, server_default='0'))
        batch.add_column(sa.Column('escalated_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('escalation_reason', sa.Text(), nullable=False, server_default=''))
        batch.add_column(sa.Column('escalation_guidance', sa.Text(), nullable=False, server_default=''))

    # Existing data (e.g. on Render): stations to regions; existing regional staff work in Nairobi.
    for station, region in STATION_REGIONS.items():
        op.execute(sa.text("UPDATE equipment SET region = :region WHERE station = :station").bindparams(region=region, station=station))
    roles = ", ".join(f"'{role}'" for role in REGIONAL_ROLES)
    op.execute(f"UPDATE users SET region = 'Nairobi' WHERE role IN ({roles}) AND section <> ''")


def downgrade() -> None:
    with op.batch_alter_table('faults') as batch:
        for column in ('escalation_guidance', 'escalation_reason', 'escalated_at', 'escalation_level'):
            batch.drop_column(column)
    with op.batch_alter_table('equipment') as batch:
        batch.drop_column('region')
    with op.batch_alter_table('users') as batch:
        batch.drop_column('requested_region')
        batch.drop_column('region')

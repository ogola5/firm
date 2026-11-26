"""open pickup: helpers on a job; CT checks the write-up after the fix; Instrumentation merged into Systems Automation

Revision ID: 0013
Revises: 0012
Create Date: 2026-12-03 09:00:00
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None

OLD, NEW = 'Instrumentation', 'Systems Automation'
SECTION_COLUMNS = (
    ('users', 'section'), ('users', 'requested_section'), ('equipment', 'section'), ('faults', 'assigned_section'),
    ('fault_assignments', 'section'), ('fault_assignments', 'requested_next_section'), ('procedure_updates', 'section'),
    ('expert_sessions', 'section'), ('expert_questions', 'section'), ('drawings', 'discipline'), ('awards', 'scope'),
)


def upgrade() -> None:
    op.create_table(
        'fault_helpers',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('assignment_id', sa.String(), sa.ForeignKey('fault_assignments.id'), nullable=False, index=True),
        sa.Column('fault_id', sa.String(), sa.ForeignKey('faults.id'), nullable=False, index=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('added_by_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('note', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    )
    bind = op.get_bind()
    now = datetime.now(timezone.utc)

    # Instrumentation and Control is now Systems Automation.
    for table, column in SECTION_COLUMNS:
        bind.execute(sa.text(f"UPDATE {table} SET {column} = :new WHERE {column} = :old"), {"new": NEW, "old": OLD})
    for table in ('equipment', 'faults'):
        bind.execute(sa.text(f"UPDATE {table} SET category = 'Automation' WHERE category = :old"), {"old": OLD})
    bind.execute(sa.text("UPDATE users SET display_name = REPLACE(display_name, :old, :new)"), {"new": NEW, "old": OLD})
    # Faults waiting for the asset to be identified move to Systems Automation's placeholder.
    old_placeholder, new_placeholder = 'EQ-UNCONFIRMED-instrumentation', 'EQ-UNCONFIRMED-systems-automation'
    if bind.execute(sa.text("SELECT 1 FROM equipment WHERE id = :id"), {"id": new_placeholder}).first():
        bind.execute(sa.text("UPDATE faults SET equipment_id = :new WHERE equipment_id = :old"),
                     {"new": new_placeholder, "old": old_placeholder})
    # The demonstration Instrumentation accounts duplicate Systems Automation's: their records stay,
    # the accounts close, and knowledge they owned passes to the Systems Automation counterpart.
    duplicates = bind.execute(sa.text(
        "SELECT id FROM users WHERE id = 'USER-instrumentation' OR id LIKE 'USER-%-instrumentation' OR id LIKE 'USER-%-instrumentation-%'"
    )).scalars().all()
    for old_id in duplicates:
        new_id = 'USER-automation' if old_id == 'USER-instrumentation' else old_id.replace('-instrumentation', '-systems-automation')
        if bind.execute(sa.text("SELECT 1 FROM users WHERE id = :id"), {"id": new_id}).first():
            bind.execute(sa.text("UPDATE equipment_type_owners SET owner_id = :new WHERE owner_id = :old"), {"new": new_id, "old": old_id})
        bind.execute(sa.text("UPDATE users SET active = 0 WHERE id = :id"), {"id": old_id})

    # The Chief Technician now checks the write-up after the fix instead of before: work waiting
    # for that sign-off counts as working again from the time the technician gave.
    waiting = bind.execute(sa.text(
        "SELECT a.id, a.fault_id, a.back_in_service_at, a.assigned_user_id FROM fault_assignments a "
        "JOIN faults f ON f.id = a.fault_id WHERE f.status = 'AWAITING_CHIEF_REVIEW' AND a.completion_review_status = 'PENDING' "
        "AND a.status IN ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS')"
    )).all()
    for assignment_id, fault_id, back_at, actor_id in waiting:
        bind.execute(sa.text("UPDATE fault_assignments SET status = 'RESTORED', completed_at = :now WHERE id = :id"),
                     {"now": now, "id": assignment_id})
        bind.execute(sa.text("UPDATE faults SET status = 'RESTORED', restored_at = :at WHERE id = :id"),
                     {"at": back_at or now, "id": fault_id})
        bind.execute(sa.text(
            "INSERT INTO fault_events (id, fault_id, event_type, actor_id, payload, created_at) "
            "VALUES (:id, :fault_id, 'FAULT_RESTORE', :actor, :payload, :at)"
        ), {"id": str(uuid.uuid4()), "fault_id": fault_id, "actor": actor_id or "SYSTEM",
            "payload": json.dumps({"assignment_id": assignment_id, "review": "after"}), "at": back_at or now})


def downgrade() -> None:
    op.drop_table('fault_helpers')

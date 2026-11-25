"""points and awards, cause/action pick-lists, drawing differences and register,
expert knowledge capture, shadowing, watch-list snapshots

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-26 09:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None

# Starting values; HR changes them on the Recognition page.
DEFAULT_RULES = [
    ("PROCEDURE_APPROVED", "Procedure approved", 10, "A procedure you wrote was approved for the library."),
    ("REVISION_APPROVED", "Procedure improvement approved", 2, "Your improvement to an existing procedure was approved."),
    ("REUSE_CONFIRMED", "A colleague fixed it with your procedure", 5, "Someone else used your procedure and it worked."),
    ("EXPERT_SESSION", "Expert session approved", 15, "You shared your experience of an equipment type in an expert session."),
    ("EXPERT_SESSION_SCRIBE", "Expert session written up", 3, "You wrote up an expert session."),
    ("DRAWING_DIFFERENCE", "Drawing difference verified", 5, "You recorded where the equipment differs from its drawing and it was verified."),
    ("ANSWER_ACCEPTED", "Answer accepted", 3, "Your answer to a colleague's question was accepted."),
    ("SHADOW_JOB", "Shadowing job completed", 3, "You worked a job as expert adviser or as the person learning."),
    ("COMPLETE_WRITE_UP", "Complete write-up", 1, "A job written up with what was found, what was done and the back-in-service time."),
]


def upgrade() -> None:
    with op.batch_alter_table('diagnoses') as batch:
        batch.add_column(sa.Column('cause_category', sa.String(), nullable=False, server_default=''))
    with op.batch_alter_table('interventions') as batch:
        batch.add_column(sa.Column('action_type', sa.String(), nullable=False, server_default=''))
    with op.batch_alter_table('fault_assignments') as batch:
        batch.add_column(sa.Column('adviser_id', sa.String(), nullable=True))
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('retirement_date', sa.Date(), nullable=True))

    rules = op.create_table(
        'point_rules',
        sa.Column('kind', sa.String(), primary_key=True),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('points', sa.Integer(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('active', sa.Integer(), nullable=False, server_default='1'),
    )
    op.bulk_insert(rules, [{"kind": k, "label": l, "points": p, "description": d, "active": 1} for k, l, p, d in DEFAULT_RULES])
    settings = op.create_table(
        'hr_settings',
        sa.Column('key', sa.String(), primary_key=True),
        sa.Column('value', sa.String(), nullable=False),
    )
    op.bulk_insert(settings, [
        {"key": "monthly_cap", "value": "150"},
        {"key": "point_value", "value": "1 point = KES 50 (illustrative; HR to set)"},
    ])
    op.create_table(
        'points_ledger',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('kind', sa.String(), nullable=False),
        sa.Column('points', sa.Integer(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('source_type', sa.String(), nullable=False, server_default=''),
        sa.Column('source_id', sa.String(), nullable=False, server_default=''),
        sa.Column('link', sa.String(), nullable=False, server_default=''),
        sa.Column('earned_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_by_id', sa.String(), nullable=True),
        sa.UniqueConstraint('user_id', 'kind', 'source_id', name='uq_points_source'),
    )
    op.create_table(
        'point_redemptions',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('points', sa.Integer(), nullable=False),
        sa.Column('option', sa.String(), nullable=False),
        sa.Column('value_text', sa.String(), nullable=False, server_default=''),
        sa.Column('note', sa.Text(), nullable=False, server_default=''),
        sa.Column('recorded_by_id', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        'awards',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('award_type', sa.String(), nullable=False),
        sa.Column('period_key', sa.String(), nullable=False),
        sa.Column('scope', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('citation', sa.Text(), nullable=False),
        sa.Column('prize', sa.String(), nullable=False, server_default=''),
        sa.Column('decided_by_id', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('award_type', 'period_key', 'scope', name='uq_award_period_scope'),
    )

    op.create_table(
        'drawings',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('number', sa.String(), nullable=False, unique=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('revision', sa.String(), nullable=False, server_default=''),
        sa.Column('discipline', sa.String(), nullable=False, server_default=''),
        sa.Column('status', sa.String(), nullable=False, server_default='PAPER'),  # PAPER or DIGITISED
        sa.Column('document_url', sa.String(), nullable=True),
        sa.Column('source', sa.String(), nullable=False, server_default='Local register'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        'drawing_equipment',
        sa.Column('drawing_id', sa.String(), sa.ForeignKey('drawings.id'), primary_key=True),
        sa.Column('equipment_id', sa.String(), sa.ForeignKey('equipment.id'), primary_key=True),
    )
    op.create_table(
        'drawing_differences',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('equipment_id', sa.String(), sa.ForeignKey('equipment.id'), nullable=False, index=True),
        sa.Column('drawing_id', sa.String(), sa.ForeignKey('drawings.id'), nullable=True),
        sa.Column('drawing_number_text', sa.String(), nullable=False, server_default=''),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('permanence', sa.String(), nullable=False),  # PERMANENT or TEMPORARY
        sa.Column('fault_id', sa.String(), sa.ForeignKey('faults.id'), nullable=True),
        sa.Column('reported_by_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('reported_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='REPORTED'),  # REPORTED, VERIFIED, REJECTED, INCORPORATED
        sa.Column('verified_by_id', sa.String(), nullable=True),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('review_note', sa.Text(), nullable=False, server_default=''),
        sa.Column('incorporated_revision', sa.String(), nullable=False, server_default=''),
        sa.Column('incorporated_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        'expert_sessions',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('expert_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('scribe_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('equipment_type', sa.String(), nullable=False),
        sa.Column('section', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('how_it_fails', sa.Text(), nullable=False, server_default=''),
        sa.Column('first_checks', sa.Text(), nullable=False, server_default=''),
        sa.Column('what_fools_people', sa.Text(), nullable=False, server_default=''),
        sa.Column('tricks', sa.Text(), nullable=False, server_default=''),
        sa.Column('parts', sa.Text(), nullable=False, server_default=''),
        sa.Column('safety', sa.Text(), nullable=False, server_default=''),
        sa.Column('status', sa.String(), nullable=False, server_default='SUBMITTED'),  # SUBMITTED, APPROVED, RETURNED
        sa.Column('reviewer_id', sa.String(), nullable=True),
        sa.Column('review_note', sa.Text(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        'expert_questions',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('equipment_type', sa.String(), nullable=False),
        sa.Column('section', sa.String(), nullable=False),
        sa.Column('asked_by_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('status', sa.String(), nullable=False, server_default='OPEN'),  # OPEN or ANSWERED
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        'expert_answers',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('question_id', sa.String(), sa.ForeignKey('expert_questions.id'), nullable=False, index=True),
        sa.Column('author_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('accepted', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('accepted_by_id', sa.String(), nullable=True),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    for table in ('expert_answers', 'expert_questions', 'expert_sessions', 'drawing_differences', 'drawing_equipment',
                  'drawings', 'awards', 'point_redemptions', 'points_ledger', 'hr_settings', 'point_rules'):
        op.drop_table(table)
    with op.batch_alter_table('users') as batch:
        batch.drop_column('retirement_date')
    with op.batch_alter_table('fault_assignments') as batch:
        batch.drop_column('adviser_id')
    with op.batch_alter_table('interventions') as batch:
        batch.drop_column('action_type')
    with op.batch_alter_table('diagnoses') as batch:
        batch.drop_column('cause_category')

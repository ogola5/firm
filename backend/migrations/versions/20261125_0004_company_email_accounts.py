"""company email accounts: enrolment, approval, lockout, password reset, demo mailbox

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-25 15:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('email', sa.String(), nullable=True))
        batch.add_column(sa.Column('staff_number', sa.String(), nullable=False, server_default=''))
        batch.add_column(sa.Column('job_title', sa.String(), nullable=False, server_default=''))
        # ACTIVE, UNVERIFIED, PENDING_APPROVAL, REJECTED, DISABLED. `active` stays in step with it.
        batch.add_column(sa.Column('account_status', sa.String(), nullable=False, server_default='ACTIVE'))
        batch.add_column(sa.Column('requested_role', sa.String(), nullable=False, server_default=''))
        batch.add_column(sa.Column('requested_section', sa.String(), nullable=False, server_default=''))
        batch.add_column(sa.Column('decision_note', sa.Text(), nullable=False, server_default=''))
        batch.add_column(sa.Column('decided_by_id', sa.String(), nullable=True))
        batch.add_column(sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('failed_logins', sa.Integer(), nullable=False, server_default='0'))
        batch.add_column(sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('password_changed_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('created_at', sa.DateTime(timezone=True), nullable=True))

    # Existing accounts get a company address: seeded demo accounts are clearly marked "demo.".
    op.execute("UPDATE users SET email = 'demo.' || lower(username) || '@kpc.co.ke' WHERE id LIKE 'USER-%'")
    op.execute("UPDATE users SET email = lower(username) || '@kpc.co.ke' WHERE email IS NULL AND username NOT LIKE '%@%'")
    op.execute("UPDATE users SET email = lower(username) WHERE email IS NULL")
    op.execute("UPDATE users SET account_status = 'DISABLED' WHERE active = 0")

    with op.batch_alter_table('users') as batch:
        batch.alter_column('email', existing_type=sa.String(), nullable=False)
        batch.create_unique_constraint('uq_users_email', ['email'])

    op.create_table(
        'email_codes',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('email', sa.String(), nullable=False, index=True),
        sa.Column('purpose', sa.String(), nullable=False),  # VERIFY_EMAIL or RESET_PASSWORD
        sa.Column('code_hash', sa.String(), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        'mail_outbox',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('recipient', sa.String(), nullable=False, index=True),
        sa.Column('subject', sa.String(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('mail_outbox')
    op.drop_table('email_codes')
    with op.batch_alter_table('users') as batch:
        batch.drop_constraint('uq_users_email', type_='unique')
        for column in ('created_at', 'password_changed_at', 'last_login_at', 'locked_until', 'failed_logins',
                       'email_verified_at', 'decided_at', 'decided_by_id', 'decision_note', 'requested_section',
                       'requested_role', 'account_status', 'job_title', 'staff_number', 'email'):
            batch.drop_column(column)

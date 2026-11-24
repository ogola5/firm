# Database Design

PostgreSQL 16 is the system of record, accessed through SQLAlchemy 2 with schema managed by Alembic (`backend/migrations`). The test suite also runs on SQLite for speed; set `KPC_TEST_DATABASE_URL` to run it on PostgreSQL.

## Tables

| Area | Tables |
|---|---|
| People and access | `users` (role key, section, availability, competencies), `user_audit` |
| Assets | `equipment` (tag, station, owning section, criticality) |
| Fault lifecycle | `faults`, `fault_events` (append-only timeline), `fault_assignments` (section handoff chain via `previous_assignment_id`), `fault_attachments` |
| Investigation | `diagnoses` (possible causes, quick checks, risk), `interventions` (successful and failed attempts) |
| Knowledge | `knowledge_entries` (legacy work instructions and library entries), `procedure_updates` (fault-derived procedures; versions linked by `lineage_id` and `previous_update_id`), `procedure_reviews` |
| Reuse | `knowledge_reuse`, `knowledge_reuse_outcomes` |
| Offline sync | `sync_events` (`event_id` is the idempotency key) |

Roles are a fixed set defined in `services/access.py` rather than `roles`/`permissions` tables: the 15 demonstration roles and their permissions are part of the prototype's design, and keeping them in code keeps backend and tests consistent. A table-driven model can be introduced if role configuration must become editable at runtime.

## Integrity

- Foreign keys are enforced (PostgreSQL). Several models declare foreign keys without ORM relationships, so code that inserts a parent and child in one transaction must `flush()` the parent first.
- Indexed columns: every fault/assignment/procedure/equipment foreign key, `faults.status`, `faults.created_at`, `procedure_updates.lineage_id`, `sync_events.fault_id`.
- Timestamps are timezone-aware UTC.
- Normal application operations do not delete fault, investigation or knowledge records.

## Commands

```bash
cd backend
python -m app.cli migrate   # apply migrations
python -m app.cli seed      # load illustrative data into an empty database
python -m app.cli reset     # drop all tables, migrate and reseed
alembic revision --autogenerate -m "describe change"   # after editing models.py
```

The seed is deterministic and labels every asset, person and fault as synthetic demonstration data.

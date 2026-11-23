# Database Design

The prototype currently uses SQLite and SQLAlchemy. Production deployment should use PostgreSQL with the same models.

Core tables: `users`, `equipment`, `faults`, `fault_events`, `knowledge_entries`, and `sync_events`. UUID/text identifiers are used for important records, with foreign keys for equipment, users and faults. Fault state changes are append-only through `fault_events`; synchronisation uses `sync_events.event_id` as an idempotency key.

The seed is deterministic and labels every asset or fault as synthetic demonstration data.

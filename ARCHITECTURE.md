# Architecture

The prototype uses a modular monolith: the FastAPI backend owns domain rules and persistence, while the React frontend provides role-specific workflows. SQLite is selected for the out-of-box prototype and can be replaced with PostgreSQL without changing API contracts.

Important records are append-only by state events. Synchronisation uses idempotent client event IDs. Offline state is stored in IndexedDB and backed by a PWA service worker.

# Offline Synchronisation Design

The frontend stores an IndexedDB pending-event outbox with a unique event ID, client timestamp and sequence number. Offline faults and events remain in Dexie until connectivity returns. The Sync Now action sends events to `/api/v1/sync/events`; the backend uses `event_id` as an idempotency key and acknowledges duplicate events instead of applying them twice.

The PWA service worker caches the application shell. Dexie caches equipment, fault summaries and knowledge. Actual API reachability, Background Sync and a more complete conflict reconciliation UI remain extension work.

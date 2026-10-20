---
id: offline-pwa
solves: A web app that keeps working without network — service worker caches the app shell, writes go to an IndexedDB outbox, and are replayed idempotently when online.
triggers: offline, pwa, service worker, sync, intermittent connectivity, indexeddb
not_when: Data must never be stale (prices at checkout); the app is server-rendered only.
status: candidate
consumers: prior-project (ASSUMED, brief Part 1)
license: MIT, written for tins-kit
source: original
review_by: 2027-04-01
---
Each queued write carries a client-generated id so replays are idempotent on the server.
Unverified: no module, no test.

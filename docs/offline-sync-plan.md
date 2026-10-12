# PATROL offline sync plan

Decision (2026-10-12): patrollers can START a patrol offline and continue one offline.

## Why
Patrollers hit no-coverage stops. Today the app cannot open offline (no service worker) and every save blocks on the network.

## Writes that must be queueable
1. Start patrol: `patrol_sessions` insert (server makes the id today -> make it client-side)
2. Add business: `patrol_businesses` insert (server makes the id today -> make it client-side)
3. Photo upload to `patrol-media` (storage)
4. Sign: `sign_inspections` insert (client uuid already). Trigger `patrol_lead_for_inspection` creates/merges the CRM lead and RAISES if the business row is missing.
5. `inspection_photos` insert (client uuids already)
6. Quick Catch: photos, `sign_inspections` stub, `inspection_photos`, `leads` insert (client uuids already)
7. Finish patrol: `patrol_sessions` update

Upload order per chain: session -> business -> photos -> sign -> photo rows -> finish.

## Steps
1. [DONE in this change] Offline app shell (service worker) + Offline badge. Updates never reload mid-patrol.
2. Local outbox in IndexedDB (photo blobs included). Each entry carries user id + organisation id and its capture time (not sync time).
3. Client-generated ids for session and business.
4. Sync engine: dependency order, retry with backoff, "already exists" counts as success, a failed entry blocks only its own chain and is flagged.
5. Triggers: app open, `online` event, manual "Sync now" (iOS has no true background sync, as far as we know).
6. UI: pending-count badge (store already has an unused `pendingCount`), failed-items list with Retry, confirm dialog on logout when anything is unsynced (queue never wiped silently).
7. Quick Catch moves to the queue.
8. Tests: queue and ordering logic as pure functions (node tests); manual airplane-mode run through a full route.

## Also needed offline
- Zone info / route preview currently fetch from Supabase: cache them.
- Resume lookup (`fetchResumableSession`) needs the network: resume from local state when offline.

## Risks
- Phones can evict stored data under low storage: request persistent storage, warn on a large queue.
- `navigator.onLine` can say online with no real signal: the sync engine, not the badge, decides success.
- Not yet read in full: finish-patrol, resume and patrol-type pages.

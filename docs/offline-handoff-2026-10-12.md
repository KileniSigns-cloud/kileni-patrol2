# PATROL offline sync: handoff (2026-10-12)

## Branches (both pushed; neither merged; main deploys to production)
- `feat/offline-shell` (e919095): service worker, app shell works offline, "Offline" badge. VERIFIED by user.
- `feat/offline-zones` (6be31f9, based on offline-shell): saved zones list/preview/zone-info offline. NOT WORKING YET in user's browser.

## What was built on feat/offline-zones
- `src/lib/zoneCache.ts` (+ `tests/zoneCache.test.ts`, 11 tests; suite 216 pass): localStorage key `patrol-zone-cache:v1:<orgId>`.
- `RoutesPage`: saves list on success; on failure falls back to saved list + "No connection..." note (only if saved list is non-empty).
- `RoutePreviewPage`, `patrol.store.getZoneInfo`: fall back to the saved zone.
- 6be31f9 fix: orgId is '' at first (App.tsx/LoginPage set it from user_metadata, then App.tsx fills it from the `users` table), so RoutesPage now reads it via a ref and saves once it arrives.

## Test status
- Test account: `chaoukikileni@gmail.com` (has the zones). `kilenichaouki@email.com` is a different org with no zones (403 on create is correct, not a bug).
- Offline reload of /routes STILL shows "Something went wrong / TypeError: Failed to fetch" after the 6be31f9 fix. Not confirmed whether the user pulled + rebuilt before testing (bundle was still `index-DB9edYFZ.js` in earlier screenshots; the fixed build would have a new hash).
- Latest screenshot: Application > Service workers shows sw.js with a red error badge (2) next to it, "Offline" + "Update on reload" ticked. Look at those 2 errors first.
- Never verified: whether `patrol-zone-cache:v1:...` exists in Local storage after an online load.

## Next steps for the new chat (do in this order, decisive checks, no guessing)
1. Confirm `git pull` on feat/offline-zones, `npm run build`, `npx vite preview`; confirm served bundle hash changed.
2. Online on /routes: console `Object.keys(localStorage)` and `JSON.parse(localStorage.getItem('patrol-store')).state.currentUser`. Is there a `patrol-zone-cache:v1:<uuid>` key? Is organisation_id non-empty?
3. Read the sw.js errors (Application > Service workers > click the red 2 / Console).
4. Check RoutesPage catch path offline: supabase-js may return `{error}` with a non-throw path, or `setError` may be hit because `loadZoneCache` returned null (org id mismatch between saved key and read key; compare keys).
5. Once offline zones work: verify preview + Zone info, then merge both branches (user decides), then Step 2 (IndexedDB outbox) per docs/offline-sync-plan.md.

## Plan reference
docs/offline-sync-plan.md (steps 1-8). Known gaps: start patrol offline fails, resume offline, all saves need network.

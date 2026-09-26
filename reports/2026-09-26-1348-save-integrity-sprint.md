# Save Integrity sprint: patrol2, items 1–5

Report only. No code or DB changes. Repo HEAD is `3ee5a89` and the working tree is clean.

This report replaces `2026-09-25-1702-save-integrity-sprint.md`, which covered items 1–2 only because that request was cut off. I re-checked items 1–2 against the same HEAD, and this time I could also check the live DB.

**Evidence levels**
- **Verified (code):** I read the file and lines cited.
- **Verified (live DB):** I ran a read-only `SELECT` against project `zwefxwjvptahvywkemvg` (Kileni-signs, the URL in `.env.local`) through `supabase db query --linked`. The project was linked in a scratchpad folder, not in the repo. Every query was a `SELECT` against the catalog or an aggregate. No rows were changed.
- **Inferred:** reasoning from verified facts. The leap is stated each time.
- **Cannot verify:** the Auth dashboard settings (SMTP, Site URL, redirect URLs). SQL can't reach them. Where to check them is under item 5.

---

## Quick answer: `idx_patrol_sessions_route_started`

**Present in the live DB (verified).** `pg_indexes` returns:

```
CREATE INDEX idx_patrol_sessions_route_started ON public.patrol_sessions USING btree (route_id, started_at DESC)
```

`patrol_sessions` has three other indexes: `patrol_sessions_pkey`, `patrol_sessions_route_status_idx (route_id, status)` and `patrol_sessions_status_idx (status)`.

**No migration file creates this index.** I grepped every `.sql`, `.md`, `.ts` and `.tsx` file under `D:\Business\App` for `route_started` and found nothing. It was applied by hand. If you want the repo to reproduce the live DB, add a `CREATE INDEX IF NOT EXISTS` to the next migration.

---

## Live-DB facts used below (all verified)

| Fact | Value |
|---|---|
| Organisations | `8239bb55-…2275` "BUILT - Close every lead", `7c1e72b8-…3af1` "Kileni Signs" |
| `public.users` rows by org | 5 users, all in `8239bb55` |
| `auth.users` | 7 users, all on the `email` identity provider. **2 of the 7 have no org in `public.users`**, and 1 of those 2 has an org only in `user_metadata`. |
| `patrol_sessions` | 42 rows. All have a `route_id`, and all of those routes are in `8239bb55`. No `organisation_id` column. |
| `patrol_sessions` RLS | RLS is on. There is one policy, `"All authenticated users"`: **`ALL`** commands, `USING (auth.role() = 'authenticated')`. |
| `patrol_businesses` | 41 rows. **Only 10 have `rep_id` set.** 6 have no signs. 1 of those 6 has a sibling in the same session created within 10 minutes. |
| `patrol_businesses` triggers | None. This matches 005, which dropped `on_patrol_business_added`. |
| `sign_inspections` triggers | `on_patrol_inspection_saved`, from 005, and `update_sign_inspections_updated_at` |
| `leads.organisation_id` default | `'8239bb55-2423-43c1-bb54-6370765f2275'::uuid`, hardcoded in the DB |
| `patrol_sessions.route_id` FK | `ON DELETE CASCADE` |

---

## 1. Duplicate business when going back from Photos to Business

### Current behaviour (verified in code; unchanged since the 09-25 report)

- **Where `businessId` lives.** It is React state in `src/context/PatrolSessionContext.tsx:74` and is not persisted. The setter the app exposes is `setBusinessIdForNewBusiness` (`:89-95`, exposed at `:215`). It also clears `reusingBusiness`, `inspectionId` and the photo URLs.
- **`AddBusinessPage` always inserts.** `src/pages/AddBusinessPage.tsx:36-53` runs `.insert({...})` on `patrol_businesses`.
  - It never reads the context `businessId`, so it can't tell that it already saved a row in this flow.
  - The form fields are `useState('')` (`:21-23`), so going back shows an empty form.
  - `useGPS()` (`:19`) captures a fresh location on every mount.
- **How the patroller gets back.** Two ways:
  - The Back button: `PhotoUploadPage.tsx:115-116`, `if (!reusingBusiness) return navigate('/add-business/' + sessionId)`. This is a push navigation.
  - The browser or Android back gesture: `AddBusinessPage.tsx:66` pushed `/photos`, so the Business page is still in history.
- **What a second Save does.**
  - It inserts row #2.
  - `addLoggedBusiness` then adds a second list entry, because `withBusinessAdded` dedupes by id and the id is new (`signFlow.ts:55-57`).
  - Row #1 is left as an orphan with 0 signs, still listed on Active patrol.

### Second lead (inferred from the 005 SQL)

A duplicate row on its own no longer creates a lead. Since 005, leads are created only on a `sign_inspections` insert (`005:192-195`).

A second lead appears when a sign is later saved against the orphan row, which happens if the patroller taps the orphan on Active patrol (`ActivePatrolPage.tsx:83-85`). The trigger's revisit match (`005:100-119`) needs both of these to reuse the first lead:
- a non-blank name that matches after normalisation;
- GPS within 150 m, or a matching normalised address.

The form comes back empty, so a blank or different name is likely, and a second lead follows.

**Seen in production? Probably.** 1 orphan has a same-session sibling created within 10 minutes. That fits this bug, but it could also be a legitimate empty business. Not proven.

### Did 005/006 change it?

- **005:** did not touch `AddBusinessPage`. It made the effect smaller: before 005, every business row created a lead.
- **006 (`2c44545`):** added the resets in `setBusinessIdForNewBusiness` (`:92-94`).
  - Side effect: re-saving after photos were uploaded drops `inspectionId`. The objects already uploaded under `patrol-media/{org}/patrol/{old id}/` are orphaned.
  - No data is lost, because the flow uploads again.
- The insert-only behaviour predates both.

### New finding: an update-based fix needs `rep_id` (verified in live DB)

Live `UPDATE` policies on `patrol_businesses` are `patrol_businesses_update_owned` and `update_own`. Both require `rep_id = auth.uid()`. `AddBusinessPage` never sets `rep_id`, and 31 of the 41 live rows have none.

A re-save done as an `UPDATE` would therefore match 0 rows under RLS. With `.select().single()` that returns a PGRST116 error; without it, the update silently does nothing. The fix has to set `rep_id` on insert.

### Proposed fix

1. **Clean draft per new business.** The "Add business" button calls `resetInspection()` before navigating (`ActivePatrolPage.tsx:106`). This is the same change as item 2.
2. **Re-save updates instead of inserting.**
   - The first save inserts with `rep_id: currentUser.id` and `organisation_id: currentUser.organisation_id` (see item 3).
   - If the context `businessId` is already set when the page mounts, this is a revisit inside the same flow. Save then becomes `.update({...}).eq('id', businessId).select().single()`.
   - An `upsert` also works (INSERT and UPDATE policies both exist), but the explicit branch is easier to read and to test.
3. **Prefill on revisit** from the `loggedBusinesses` entry for `businessId`: name, address, lat and lng. Keep the stored GPS unless the patroller taps Redo. Notes are not in `LoggedBusiness` (`signFlow.ts:43-52`): either add them or `select` the row.
4. **Replace, don't append, in the list.** Add `withBusinessUpdated(list, b)` beside `withBusinessAdded` (`signFlow.ts`).
5. **Edit path keeps the sign's state.** The edit path sets the name without calling `setBusinessIdForNewBusiness`, so `inspectionId` and the photos are kept.
6. **Tests** in `tests/signFlow.test.ts`:
   - re-save keeps the id and does not grow the list;
   - after `resetInspection`, `businessId` is null.

### Risk

- **Medium-low.** The change is confined to AddBusinessPage, the context and one pure helper.
- **RLS is the main trap** (above). It must be tested on the live DB with a patroller account, not an admin one.
- **Existing orphans stay.** Cleaning them up is a separate, write-bearing job.

---

## 2. Previous sign's issues pre-ticked on the next business

### Current behaviour (verified in code; unchanged since the 09-25 report)

- **Where the state lives.** `currentIssues` and `currentNotes` are context state (`PatrolSessionContext.tsx:83-84`). `IssuesPage` seeds its local state from them on mount: `useState(currentIssues)` and `useState(currentNotes)` (`IssuesPage.tsx:41-42`).
- **Paths that reset.**
  - "Log another sign here": `SuccessPage.tsx:30-32` → `resetForNextSign()` (`signFlow.ts:26-40`).
  - Tapping a listed business: `startSignAtBusiness` → `draftForExistingBusiness` → `resetForNextSign`.
- **The bug path: "Done" → "Add business".**
  - `SuccessPage.tsx:42` and `ActivePatrolPage.tsx:106` only navigate.
  - `AddBusinessPage` then calls `setBusinessIdForNewBusiness`, which clears only `reusingBusiness`, `inspectionId` and the photos (`:89-95`).
- **What survives into the next business:**
  - `currentIssues`, pre-ticked on `IssuesPage`;
  - `currentNotes`;
  - `signCategory` and `signType`, pre-selected on `SignTypePage.tsx:60-61`;
  - `patrolType` (`PatrolTypePage.tsx:23`).
- **What gets saved.** Unless unticked, the stale issues go into `sign_inspections.condition`, `condition_rating` and `non_compliance_reason` (`signFlow.ts:146-149`). Through 005 they are then merged into the lead's `issue_type` (`005:136-150`).
- **The fix already exists but is unused.** `resetInspection` (`PatrolSessionContext.tsx:157-168`) clears exactly this state and has **no callers**.

### Did 005/006 change it?

- **005:** no change to app state. It made the effect bigger: stale issues now merge into the business's single lead.
- **006:** added only the photo and `inspectionId` clears.

### Proposed fix

- Call `resetInspection()` in the "Add business" handler (`ActivePatrolPage.tsx:106`).
- Optionally, also clear `signCategory`, `signType`, `currentIssues` and `currentNotes` in `setBusinessIdForNewBusiness` as belt and braces. The item 1 edit path must then use a setter that does not reset.
- Decide whether `patrolType` (day/night) carries over to the next business. Today `resetInspection` keeps it (`:167`).
- Test: a pure `draftForNewBusiness()` in `signFlow.ts`, used by both `resetInspection` and the test.

### Risk

- **Low.** It changes state on an explicit "new business" action, with no DB change.

---

## 3. Hardcoded organisation IDs

### Every occurrence (verified by grep and a live-DB catalog search)

I grepped `src`, `tests`, `scripts`, `migrations`, `index.html` and `public` for any UUID literal. I also searched `pg_proc` source and column defaults in the live DB for `8239bb55`.

| # | Location | What | Action |
|---|---|---|---|
| 1 | `src/lib/signFlow.ts:105` (used at `:141`) | `const ORG_ID = '8239bb55-…'`, used in the `sign_inspections` insert row | Replace |
| 2 | `src/pages/AddBusinessPage.tsx:40` | `organisation_id: '8239bb55-…'` in the `patrol_businesses` insert | Replace |
| 3 | `tests/signFlow.test.ts:93` | Expected value in the insert-payload assertion | Change to the fixture user's org |
| 4 | `tests/twoSigns.test.ts:10` | `const ORG = '8239bb55-…'` fixture | Keep as a test fixture, or rename it `FIXTURE_ORG`. It is harmless as a test value. |
| 5 | **Live DB:** `leads.organisation_id DEFAULT '8239bb55-…'::uuid` | Any insert into `leads` that omits the org lands in this org | See below |
| — | `dist/` | Build output (git-ignored) | Regenerates on build |

**Not hardcoded (verified):**
- `QuickCatchPage.tsx:70-71` uses `currentUser?.organisation_id` and errors if it is missing. 006 (`2c44545`) removed its two literals. This is the pattern to copy.
- `PhotoUploadPage.tsx:78` and `photoStorage.ts:11` already fail when the org is missing.
- The 005 trigger derives the org from the business, then the route (`005:69-78`: "Never hardcoded").
- No DB function contains the literal.

**The leads default (#5).**
- Every patrol2 path already sets the org explicitly: QuickCatch at `:95`/`:139` and the 005 trigger at `:124`. The default is therefore only a silent fallback for other writers, most likely BUILT CRM (inferred).
- Dropping it is a shared-DB change that can break BUILT inserts that rely on it. Audit BUILT's `leads` inserts first, then decide.

### How 005/006 affected this

- **`31421e7`** moved the literal from `IssuesPage` into `signFlow.ts:105`.
- **005 (`0b6a372`)** deleted a leftover unused `ORG_ID` in `IssuesPage`.
- **006 (`2c44545`)** removed the two QuickCatch literals and added the fixture in `twoSigns.test.ts`.
- #1 and #2 are untouched by both.

### Proposed fix

- **`buildSignInspectionInsert`.** Change `user` to `{ id; email; organisation_id }` and add a guard:
  - `if (!user.organisation_id) return { ok: false, error: 'Sign not saved: your account has no organisation. Ask an admin to add you.' }`
  - Use `organisation_id: user.organisation_id` in the row and delete `ORG_ID`.
  - `IssuesPage.tsx:68` already passes `currentUser`, so no call-site change is needed beyond the type.
- **`AddBusinessPage`.** Read `currentUser` from `usePatrolStore`, guard like `QuickCatchPage.tsx:71`, then insert `organisation_id: currentUser.organisation_id` and `rep_id: currentUser.id` (the `rep_id` part is item 1).
- **Tests:**
  - add `organisation_id` to the fixture user;
  - add one test where a missing org returns `ok: false`.

### Risk

- **Behaviour-neutral for current users (verified).** All 5 users with a `public.users` row are in `8239bb55`, the hardcoded value.
- **2 of the 7 auth users have no `public.users` org.**
  - Today they already cannot save a business. `patrol_businesses_insert_org` checks the org against `public.users` (inferred from the policy text).
  - After the fix they get a clear error instead of an RLS message.
  - One of them has `organisation_id` in `user_metadata`, so `currentUser.organisation_id` is non-empty for them. The client guard passes, and RLS still rejects the insert. This is not a regression, but those two accounts need `public.users` rows.
- **Load-time race.** `App.tsx:84` first sets the org from `user_metadata`, which may be empty, then overwrites it from `public.users` asynchronously (`:87-99`). A save made before that query returns would fail the guard. The Business page is several taps into the flow, so this is unlikely. It is a clear, recoverable error either way.

---

## 4. `patrol_sessions` RLS

### Current state (verified in live DB)

**It is worse than "anyone can read".** The only policy is `"All authenticated users"`, which covers **`ALL` commands** with `USING (auth.role() = 'authenticated')` and no `WITH CHECK`. Any signed-in user, from any organisation, can:
- **read** every session;
- **update** any session, including ending other people's patrols or rewriting `patroller_id`;
- **delete** any session. I did not check what that does to the businesses logged under it.

No migration in any repo creates `patrol_sessions` or this policy.

**How the app compensates today** (verified): it filters explicitly.
- `patrolApi.ts:5-6` has a comment saying these queries never rely on RLS.
- `fetchPatrolHistory` inner-joins `patrol_routes` and filters on the org (`:33,37`).
- Resume filters on `patroller_id` (`:86`).
- `routesApi.ts:84,160` filter by route id.
- The only write paths are:
  - insert: `RoutePreviewPage.tsx:49-57`, which sets `patroller_id: currentUser.id`;
  - update: `ActivePatrolPage.tsx:69-71`, which ends a session.
- No code deletes sessions.

### Options

**A. Add `organisation_id`, backfill it, and use an org policy**
- **Steps:**
  - Add the column.
  - Backfill: `update patrol_sessions s set organisation_id = r.organisation_id from patrol_routes r where r.id = s.route_id`. That is 42 rows, all mapping to `8239bb55`.
  - Set it `NOT NULL`.
  - Add a `BEFORE INSERT` trigger that derives the org from the route, so the client can't send a wrong one and `RoutePreviewPage` needs no change.
  - Add an index on the column.
  - Policies: `organisation_id = (select get_user_org_id())`.
- **For:**
  - Matches `patrol_businesses` and `sign_inspections`.
  - The policy is the cheapest possible check.
  - Supports sessions without a route later.
  - Simplifies the fallback in the 005 trigger.
- **Against:**
  - A denormalised copy of the route's org.
  - Needs a trigger to stay correct.
  - A data migration with a rollback.

**B. Scope the policy through `patrol_routes`, with no new column**
- **Policy check:** `EXISTS (select 1 from patrol_routes r where r.id = patrol_sessions.route_id and r.organisation_id = (select get_user_org_id()))`.
- **For:**
  - One migration touching policies only.
  - No backfill, no client change, and a trivial rollback.
  - Cannot drift. The org is a pure function of the route: routes are archived, not deleted (003), and no UI changes a route's org.
  - Indexes exist: `patrol_routes_pkey`, and `patrol_routes_organisation_idx`.
- **Against:**
  - A per-row semi-join. It is negligible at this size and cheap later thanks to the PK lookup.
  - A session with a null `route_id` would be invisible. There are 0 today; set `route_id NOT NULL` to make that permanent.

### Recommendation: **B**

The org already has one source of truth, the route. B closes the hole with a policy-only migration that doesn't touch data or the client. A only pays off if sessions without a route become a feature, and B can be converted to A then.

Proposed policies, replacing `"All authenticated users"` (a sketch, not applied):

```sql
ALTER TABLE patrol_sessions ALTER COLUMN route_id SET NOT NULL;  -- 0 nulls live
DROP POLICY "All authenticated users" ON patrol_sessions;
-- in_org(route_id) := EXISTS (SELECT 1 FROM patrol_routes r WHERE r.id = route_id AND r.organisation_id = (SELECT get_user_org_id()))
CREATE POLICY patrol_sessions_select_org ON patrol_sessions FOR SELECT TO authenticated USING (<in_org>);
CREATE POLICY patrol_sessions_insert_own ON patrol_sessions FOR INSERT TO authenticated
  WITH CHECK (patroller_id = auth.uid() AND <in_org>);
CREATE POLICY patrol_sessions_update_own ON patrol_sessions FOR UPDATE TO authenticated
  USING (<in_org> AND (patroller_id = auth.uid() OR (SELECT is_current_user_admin())))
  WITH CHECK (<in_org>);
-- No DELETE policy: nothing in the app deletes sessions.
```

The rollback re-creates the old policy verbatim.

### Risk

- **Medium.** A policy mistake shows up as empty lists or "Failed to start patrol".
- **Users without a `public.users` row.** `get_user_org_id()` requires `users.active = true`, so the 2 users without a row lose access to sessions. They already can't save businesses.
- **Patrollers who are not admins.** `fetchLastPatrolled` and route stats read other patrollers' sessions in the same org, which `select_org` allows.
- **Pre-flight.** Before applying, check with a patroller account that `patrol_routes` `select_org` lets them see the route. The policy subquery runs under their RLS.
- **Keep the app filters in `patrolApi.ts`** as defence in depth.

### Related finding outside the five items: anonymous insert on `patrol_businesses` (verified in live DB)

Policy `anon_insert_businesses` is `FOR INSERT TO anon WITH CHECK (true)`. The anon key ships in the public JS bundle, so **anyone on the internet can insert `patrol_businesses` rows into any organisation without signing in**. No app path needs it: every insert happens after login.

Recommendation: drop it in the same migration as item 4.

`patrol_businesses` also has overlapping duplicate policies (`insert_own` and `patrol_businesses_insert_org`, `read_own_org` and `patrol_businesses_select_org`, and others). They are harmless but worth consolidating later.

---

## 5. Forgot password

### Current state (verified)

- **Auth in use:** Supabase Auth, email and password only.
  - `LoginPage.tsx:18` calls `supabase.auth.signInWithPassword`.
  - Live `auth.identities` has 7 rows, all `email`.
- **No reset flow exists.**
  - No `resetPasswordForEmail`, `updateUser` or `PASSWORD_RECOVERY` anywhere in `src`.
  - No route for it in `App.tsx:41-60`.
  - Live `auth.users` has `recovery_sent_at` null for all 7 users, so a reset has never been sent.
- **Client:** `createClient(url, anonKey)` with defaults (`src/lib/supabase.ts:10`). With installed `@supabase/auth-js` 2.104.1, the defaults are `flowType: 'implicit'` and `detectSessionInUrl: true` (`GoTrueClient.js:22-24`). A recovery link therefore lands with `#access_token…&type=recovery`, and the client turns it into a session and fires `PASSWORD_RECOVERY`.
- **SPA routing:** `vercel.json` rewrites every path to `/index.html`, so a new `/reset-password` route works in production.

### Smallest reset-by-email flow

1. **LoginPage:** add a "Forgot password?" link under the password field. It toggles a small form with the email field only.
   - On submit, call `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })`.
   - Always show "If that email has an account, a reset link is on its way." That message doesn't reveal whether the account exists.
2. **New public route `/reset-password`** in `App.tsx`, placed before the `*` catch-all and not wrapped in the `currentUser` guard. The page:
   - has "New password" and "Confirm" fields, with a minimum length matching the project's Auth setting;
   - on submit calls `supabase.auth.updateUser({ password })`, then `navigate('/routes')`;
   - if there is no session, or the URL hash carries `error_code=otp_expired`, shows "This link has expired" with a button back to the forgot form.
3. **No global listener needed.** `redirectTo` points straight at `/reset-password`, and the existing `onAuthStateChange` in `App.tsx:109` sets `currentUser` from the recovery session.

That is two small UI pieces and one route, with no DB change.

### Dashboard prerequisites (cannot verify via SQL; please check)

- **Authentication → URL Configuration → Redirect URLs.** Add the production origin plus `/reset-password`, and `http://localhost:5173/reset-password`. Without them, Supabase ignores `redirectTo` and sends the user to the Site URL.
- **Authentication → Emails → SMTP.** Supabase's built-in email sender only delivers to members of the project's team and is heavily rate-limited. That is from Supabase's documented policy, not checked on this project. If custom SMTP is not configured, patrollers will never receive the email. **This is the most likely blocker; check it before building.**
- **"Reset password" email template.** The default `{{ .ConfirmationURL }}` works with the implicit flow.

### Risk

- **Low for the code.** The main risk is operational: SMTP and redirect configuration.
- **Recovery links sign the user in.** Someone with access to the patroller's inbox can sign in, which is standard behaviour for email reset.

---

## Recommended order

1. **Item 4 and the `anon_insert_businesses` drop, as one DB migration.**
   - Why first: it closes cross-tenant read/write/delete on sessions and anonymous inserts. It is independent of app code, and it is the only item with an internet-facing hole.
   - Ship it with a rollback file, and test with a patroller account.
2. **Item 2.**
   - Why: one line, the unused `resetInspection()`. It stops wrong issues reaching CRM leads today.
3. **Item 3.**
   - Why: small, behaviour-neutral for current users, and it changes the same insert item 1 rewrites.
4. **Item 1.**
   - Why here: it builds on 2 (the clean draft) and 3 (the org, plus `rep_id` for the update policy).
   - Items 2, 3 and 1 can be one app PR in three commits.
5. **Item 5.**
   - First confirm custom SMTP and the redirect URLs in the dashboard. The code takes about an hour once those are in place.

**Housekeeping.** Add `idx_patrol_sessions_route_started` to a migration file so the repo matches the live DB. Separately, decide on the `leads.organisation_id` default after auditing BUILT's lead inserts.

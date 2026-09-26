# public.users role escalation: evidence and migration 008

No DB changes, no testing by writing, and no commit.

**Files written:**
- `migrations/008_users_lock_role_and_org.sql`
- `migrations/008_rollback.sql`

Neither has been executed. 007 is unchanged.

**Evidence levels:**
- **Verified:** read-only `SELECT`s on the live project `zwefxwjvptahvywkemvg`, plus greps over `D:\Business\App`.
- **Inferred:** item 2 is reasoned from policies and grants only, as you asked. It has not been exercised.

---

## 1. Live definitions (verified)

**Table setup.** `public.users`: RLS on, not forced, owner `postgres`, no triggers.

### Policies

| Policy | Type | Cmd | Roles | USING | WITH CHECK |
|---|---|---|---|---|---|
| `org_isolation` | PERMISSIVE | ALL | public | `organisation_id = get_user_org_id()` | *(none: USING is reused)* |
| `users_admin_manage` | PERMISSIVE | ALL | authenticated | `(SELECT is_current_user_admin())` | `(SELECT is_current_user_admin())` |
| `users_read_own` | PERMISSIVE | SELECT | authenticated | `id = (SELECT auth.uid())` | – |
| `users_read_same_org` | PERMISSIVE | SELECT | authenticated | `organisation_id = (SELECT get_user_org_id())` | – |
| `users_self_update` | PERMISSIVE | UPDATE | authenticated | `id = (SELECT auth.uid())` | `id = (SELECT auth.uid()) AND organisation_id = (SELECT get_user_org_id()) AND role = (SELECT get_user_role())` |

### Grants

- `anon` and `authenticated` both have table-level `INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`.
- `information_schema.column_privileges` therefore shows INSERT, SELECT, UPDATE and REFERENCES on **every** column (`active, created_at, email, id, name, organisation_id, role`) for both roles.
- There are no column-level restrictions.

### Helper functions

All are `SECURITY DEFINER`, owned by `postgres`, and executable by `anon` and `authenticated`.

| Function | Body |
|---|---|
| `get_user_org_id()` | `SELECT organisation_id FROM users WHERE id = auth.uid() AND active = true LIMIT 1` |
| `get_user_role()` | `SELECT role FROM users WHERE id = auth.uid() AND active = true LIMIT 1` |
| `is_current_user_admin()` | `EXISTS (… WHERE id = auth.uid() AND active = true AND role = 'admin')` |
| `current_org_id()` | `SELECT organisation_id FROM users WHERE id = auth.uid()`, with no active check |

---

## 2. Can a signed-in non-admin UPDATE their own `users.role`? **Yes** (inferred from the definitions above)

**Scenario.** User U, active, `role = 'sales'`, org O, runs `PATCH /rest/v1/users?id=eq.U {"role":"admin"}`.

1. **Grant.** `authenticated` has table-level UPDATE, so the `role` column is writable. **Pass.**
2. **USING on the old row.** At least one permissive UPDATE/ALL policy must match. Both of these do:
   - `org_isolation`: O = `get_user_org_id()` = O;
   - `users_self_update`: id = uid.

   **Pass.**
3. **WITH CHECK on the new row.** Permissive checks are OR'd:
   - `users_self_update`: `role = get_user_role()`. The function reads the statement's snapshot, so it still sees `'sales'`, and `'admin' ≠ 'sales'`. **Fail.**
   - `org_isolation`: it has no WITH CHECK, so Postgres reuses its USING, which tests only `organisation_id = get_user_org_id()` → O = O. **Pass.**
   - `users_admin_manage`: `is_current_user_admin()` is false. **Fail.**
   - Result: one policy passes, so the **row is accepted**.
4. **Next request.** `is_current_user_admin()` is now true.
   - U has admin in every policy that uses it: `patrol_routes` insert/update and `users_admin_manage`.
   - U also has admin in every policy that inlines `users.role = 'admin'`: `org_settings`, `org_labour_rates`, `labour_departments`, `labour_tasks`, `team_members` (insert/update/delete), `team_invites` (insert/update/delete) and `team_members_audit` (select).

**Same bug, other paths** (same reasoning):
- **Change other members.** U can update anyone in O: promote, demote, change email, set `active = false`. That works because `org_isolation`'s USING matches any row in O.
- **Insert rows.** U can INSERT `users` rows in O with any role. The check is org-only, so U can give a second auth account admin.
- **Delete rows.** U can DELETE any member row in O. That locks the member out: `get_user_org_id()` becomes NULL.
- **Moving to another org is blocked.** Every check requires `organisation_id = get_user_org_id()`, which is still the old org during the statement.
- **Admins cross organisations.** `users_admin_manage` has no org test. Any admin can SELECT, UPDATE and DELETE users of **every** organisation, and can set a user's `organisation_id` to anything, including their own row. That makes it a cross-tenant takeover.
- **Anon: no access.** Every function returns NULL for anon, so no policy matches. Only the grants are over-broad.

---

## 3. What reads `users.role` for authorisation (verified)

### Functions

- **`is_current_user_admin()`**, used by:
  - `patrol_routes_insert_admin`, `patrol_routes_update_admin`;
  - `users_admin_manage`;
  - patrol2's admin gate, **indirectly**: the client reads `role` via `App.tsx:89`, and `ProtectedRoute` uses it.
- **`get_user_role()`**, used by the `users_self_update` WITH CHECK only.
- **`get_user_org_id()` and `current_org_id()`** read `organisation_id`, not role. They carry org scoping for most BUILT and patrol tables, so **`organisation_id` is as sensitive as `role`**.

### Policies that inline `users.role`

| Role checked | Policies |
|---|---|
| `'admin'` | `org_settings_admin`, `org_labour_rates_write`, `labour_departments_write`, `labour_tasks_write` |
| `'admin'` | `team_members_insert`/`_update`/`_delete`, `team_invites_insert`/`_update`/`_delete`, `team_members_audit_select` |
| `'owner'` | `org_catalog_overrides."Org owners can manage overrides"`. No user has the role `owner` today. |

### App code

**patrol2:**
- `App.tsx:89` reads `role`.
- `lib/roles.ts` / `ProtectedRoute` gate the admin pages.

**PATROL v1:**
- `lib/supabase.ts:70` reads `role`.

**BUILT:**
- `src/lib/supabase.ts:17` reads the profile, including role.
- `LeadDetailPage.tsx:285` filters users by `role IN (admin, sales)` for assignment.

**Side finding: BUILT role changes don't change permissions.** BUILT's team UI changes roles in **`team_members.role`** (`teamMembers.store.ts:200`), but authorisation reads **`users.role`**. Changing someone's role in BUILT's team screen therefore does not change what they're allowed to do. Only `claim_invite()` sets `users.role`. This is not a security hole, but it is a correctness gap.

---

## 4. Migration 008 and why it uses grants

### Choice: column-level grant as the primary control, plus a policy cleanup

**Why grants rather than a WITH CHECK pin:**
- **Permissive policies are OR'd.** A pin is only as strong as the weakest permissive policy on the table. The current hole is exactly that: `users_self_update` already pins role, and `org_isolation` bypasses it. A grant is checked before RLS and doesn't depend on which policies exist, so a future broad policy can't reopen it.
- **A policy can't see the old row.** WITH CHECK cannot reference the old value. Pinning role/org when an admin edits *another* user would need a `BEFORE UPDATE` trigger.
- **Pins rely on snapshot behaviour.** Comparing to `get_user_role()` depends on a STABLE SECURITY DEFINER function seeing the pre-update snapshot. That works, but it's subtle.
- **Nothing in the apps writes `public.users`** (see 5). A tight grant therefore breaks nothing today.
- **Cost:** a future "change role" admin screen can't write `users.role` directly. It would need a SECURITY DEFINER RPC that checks admin and same-org, which is the right pattern anyway.

**Policy changes, in the same migration:**
- **Drop `org_isolation`.** SELECT is fully covered by `users_read_own` and `users_read_same_org`. No app needs its INSERT, UPDATE or DELETE.
- **Scope `users_admin_manage`** to `organisation_id = get_user_org_id()` in both USING and WITH CHECK. This ends cross-tenant admin reads and writes.

**Grants:**

| Role | Change |
|---|---|
| `authenticated` | Revoke INSERT, UPDATE and DELETE; grant `UPDATE (name)` only |
| `anon` | Revoke INSERT, UPDATE and DELETE |

- **Kept:** SELECT, REFERENCES and TRIGGER.
- **Not touched:** TRUNCATE. PostgREST can't issue it, so it's harmless but untidy. I left it out to keep 008 narrow.

**Beyond role/org, on purpose:**
- **INSERT is revoked** because inserting a row with a chosen role is the same escalation as updating one.
- **DELETE is revoked** because no app uses it, and it lets a member lock admins out.
- **`active` and `email` are no longer self-editable.** A deactivated user shouldn't be able to reactivate, and BUILT matches invites on `users.email`.

If you want any of these out of 008, say which.

### Rollback

`008_rollback.sql` restores:
- the table-level grants for both roles;
- `org_isolation`, verbatim;
- `users_admin_manage`, verbatim.

It drops the column-level `UPDATE (name)` grant first.

---

## 5. Every app write to `public.users`, and whether it still works

**Searched:** `apps/` (patrol2, patrol v1, BUILT, including `apps/built/api`), `packages/`, `scripts/`, `supabase/functions/`, and the root `*.js`. Patterns: `from('users')`/`from("users")` followed by insert/update/upsert/delete, any `'users'` string literal, and all `rpc(...)` calls. I also searched `pg_proc` for `INSERT INTO`/`UPDATE`/`DELETE FROM users`.

**Direct API writes: none.** All 12 `from('users')` call sites are SELECTs:

| Call site | Client | Covered after 008 by |
|---|---|---|
| patrol2 `App.tsx:88` | user token | `users_read_own` |
| patrol2 `routesApi.ts:53` | user token | `users_read_own` |
| patrol2 `store/patrol.store.ts:51` | user token | `users_read_own` |
| PATROL v1 `lib/supabase.ts:70` | user token | `users_read_own` |
| BUILT `src/lib/supabase.ts:17` | user token | `users_read_own` |
| BUILT `LeadDetailPage.tsx:285` (no org filter; relies on RLS) | user token | `users_read_same_org`. For admins it now returns only their org instead of every org, which is an improvement. |
| BUILT `teamMembers.store.ts:98`, `:121` | user token | `users_read_same_org` |
| BUILT `api/send-quote.ts:65` | `supabaseAdmin` (service role) | Bypasses RLS and grants |
| `supabase/functions/send-invite` `:42`, `:106` | service role key | Bypasses RLS and grants |
| root `verify_leads_data.js` | one-off script | Not app code |

**Indirect writes:**
- **`claim_invite(p_code, p_user_id)`**, called from BUILT `teamMembers.store.ts:267`.
  - It upserts `users (id, organisation_id, name, email, role, active)`.
  - It is SECURITY DEFINER and owned by `postgres`, the table owner, with no FORCE RLS, so it bypasses both grants and RLS.
  - **Unaffected.**
- **No other function writes `users`.**
- **No triggers** exist on `auth.users`, `team_members` or `public.users`.

**Policy subqueries.** Many policies on other tables look up the caller's org or role with `SELECT … FROM users WHERE id = auth.uid()` inline. Those subqueries run with the caller's rights, and they still work:
- SELECT is still granted;
- `users_read_own` still shows the caller's own row.

**Behaviour that goes away (verified that no app code uses it):**
- a user editing their own `email` or `active` through the API;
- anyone inserting or deleting `users` rows through the API.

---

## Separate finding: `claim_invite` accepts any `p_user_id` (not fixed by 008)

**Current state (verified).** The function is executable by `anon` and `authenticated` and trusts `p_user_id`, never comparing it with `auth.uid()`.

**Risk (inferred).** Anyone who holds a pending invite code can apply it to **any** user id. That:
- overwrites the target's `organisation_id` and `role` with the invite's;
- and therefore moves or demotes that user, for example an admin.

**Fix (proposed 009):**
- use `auth.uid()` instead of `p_user_id`, and reject the call when it is NULL;
- `REVOKE EXECUTE … FROM anon`;
- optionally, require the caller's auth email to match `team_invites.email`.

BUILT's call site (`teamMembers.store.ts:267`) would drop the `p_user_id` argument.

---

## Before applying 008

1. Confirm the extra scope (INSERT and DELETE revoked; `active` and `email` locked), or tell me what to drop.
2. Test after applying:
   - patrol2 sign-in as admin (admin pages visible) and as sales (admin pages hidden);
   - BUILT: login, lead assignment dropdown, team page, invite claim.
3. Run the verify queries at the bottom of 008.
4. Order with 007: they are independent. Apply 008 first, since it's the higher risk.

---

## Pre-apply checks (2026-09-26, read-only, verified)

### 1. `claim_invite()` after 008: still works

- **Function:** `claim_invite(p_code text, p_user_id uuid)` is `SECURITY DEFINER`, owned by `postgres`, with `search_path=public`.
- **Tables it touches** (`users`, `team_members`, `team_invites`, `team_members_audit`): all owned by `postgres`, none with FORCE RLS.
- **Role:** `postgres` has `rolbypassrls = true`.
- **Why 008 can't break it:** the function runs as the table owner, so grants to `anon`/`authenticated` and RLS policies don't apply to it. 008 does not touch `EXECUTE` on the function.

### 2. Nothing writes `public.users` as `authenticated`

- **DB functions:** a search of every schema except `pg_catalog`/`information_schema` for `INSERT INTO`/`UPDATE`/`DELETE FROM`/`MERGE INTO users` finds only `claim_invite`. It is not a trigger function.
- **Triggers:** 0 triggers call any function that writes `users`.
- **Edge functions:**
  - `supabase functions list` for the project returns **none deployed**.
  - The local `supabase/functions/send-invite` only reads `users`, using the service-role key.
- **BUILT `api/` (Vercel):** `send-quote.ts` only reads `users`, using `supabaseAdmin`.

### 3. No data change in 008

- **Statements:** 008 has no DML, only `REVOKE`, `GRANT`, `DROP POLICY` and `CREATE POLICY` (grep of non-comment lines).
- **Snapshot to compare after applying:**

| id | role | organisation_id | active | fingerprint md5(id‖role‖org‖active) |
|---|---|---|---|---|
| 073772eb-e407-4ff3-89e0-c89685bb3988 | sales | 8239bb55-2423-43c1-bb54-6370765f2275 | true | 4315d047272135228b0200d29c0fcccd |
| 156d722b-e173-4c8b-ae4a-26af5873d413 | admin | 8239bb55-2423-43c1-bb54-6370765f2275 | true | 58c5b8b78384f1e544d7b10d492cd7e3 |
| a7c53f5b-7f4f-4546-bcbb-66022fd159ff | admin | 8239bb55-2423-43c1-bb54-6370765f2275 | true | 1bba492bfc6955f6bd2536300cb4a98f |
| d4aeaf87-c409-4840-9343-936be3841178 | admin | 8239bb55-2423-43c1-bb54-6370765f2275 | true | 125bdcdebd23b601301896bff5cb8f0f |
| d556e1ff-0619-4cb7-86ea-b668054d2e00 | sales | 8239bb55-2423-43c1-bb54-6370765f2275 | true | 670e9be349caabf96022263c07a49159 |

- **Re-check after applying:**
  ```sql
  select id, md5(id::text||role||organisation_id::text||active::text) fp from public.users order by id;
  ```

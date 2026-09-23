# PATROL Restyle: apply approved mockup to apps/patrol2

## Before you start
1. Save the mockup at `apps/patrol2/docs/design/patrol-app.html`.
2. Base `feat/restyle` on `feat/admin-route-management` (commit `c93314c`). Don't touch main. Rebase onto main once Project A is tested and merged.
3. Leave out local commit `9e00608`.

---

## Goal
Restyle every patrol2 screen to match `docs/design/patrol-app.html`. Open it in a browser and click through it. It is the visual and UX reference.

**This is a UI-only change.** Do not change any Supabase query, save order, table or column, RLS policy or store action. If a layout change seems to need a logic change, stop and ask first.

Branch: `feat/restyle` (see Before you start).

## Design tokens
Put these as CSS variables in the global stylesheet and map them into `tailwind.config` colours. Do not add a new colour scale beyond this set.

| Token | Day | Night | Use |
|---|---|---|---|
| --bg | #FBF6EC | #15140E | page |
| --sf | #FFFFFF | #1E1D15 | cards, inputs, tab bar |
| --sf2 | #F5E9D2 | #29271C | soft fills, table head, segmented control |
| --line | #E8D9BB | #3B382A | borders |
| --tx | #2A2816 | #F5EEDC | text |
| --mut | #66604A | #B8AF97 | secondary text (≥4.5:1) |
| --pri | #726E2B | #B8B35A | primary fills, timer bar, active states |
| --prit | #FFFFFF | #1A190A | text on --pri |
| --prix | #635F24 | #C4BF66 | primary as TEXT/ICON |
| --pris | #EFEEDB | #2E2D14 | soft olive fill, focus ring |
| --acc | #AE431E | #D06224 | issues, destructive only |
| --accs | #F8E4DA | #3C2116 | checked issue rows |
| --ok | #2F7A5E | #6FC3A0 | success |
| --oks | #E1F1EA | #16302A | success fills |

Source palette: Olive #8A8635, Chile Rojo #AE431E, Terracotta #D06224, Sunset #EAC891. The primary olive is darkened for day and lightened for night so button text meets 4.5:1 contrast. Do not use raw #8A8635 behind text.

Theme: follow `prefers-color-scheme`, plus a manual sun/moon toggle in the header, saved in localStorage (wrap it in try/catch).
Font: Manrope 500–800 with a system-ui fallback. Icons: Lucide, which the app already uses.

## Components (reuse existing ones and restyle them; do not add a component library)
- Buttons: 52 px min height, 14 px radius. Primary is --pri fill with --prit text. Hero actions are 64 px (Add business, Start patrol, Log another sign).
- Inputs: 52 px, 14 px radius, --pris focus ring.
- Cards: 18 px radius, 1 px border.
- Bottom tab bar: Routes, Patrol, History, Admin (admin role only), 66 px tall, with a red dot on Patrol while a session is live.
- Live timer bar: full-width --pri pill under the header, HH:MM:SS, shown on every screen while a session is active.
- Step progress: 5 segments (Business, Photos, Patrol type, Sign type, Issues) plus the label "Step N of 5: Name".
- Choice tiles instead of dropdowns for patrol type, sign type and the Illuminated / Non illuminated segmented control.
- Issue checkboxes as 56 px rows. A checked row turns --acc.
- Fixed footer action bar on flow screens (Back / Next). Next stays disabled until required data is present, with a one-line hint saying what's missing.
- Empty state on every list: icon, title, one sentence saying what goes there, and an action button where one exists.
- Confirm dialog for every destructive action (end patrol, discard sign, remove photo, archive route).
- Toast at top right that closes after 3 s.

## Screen by screen
1. **Routes:** search box, route cards (code badge, name, hotspot count, last patrolled).
2. **Route preview:** facts row (start point, area, focus), hotspot list, fixed "Start patrol" button.
3. **Active patrol:** 3 stat tiles (Businesses, Signs, Photos), hero "Add business", list of logged businesses (tap one to log another sign there), "End patrol" at the bottom with a confirm.
4. **Add business:** GPS capture card first with loading, captured and retry states and a ± accuracy value in m. Then name, address and notes, all marked (optional).
5. **Photos:** grid with a "Required" sign section and an "Optional" surroundings section, an Uploading/Uploaded badge per photo, and remove with confirm. Keep the existing immediate-upload logic.
6. **Patrol type:** 3 tiles. Tapping one advances.
7. **Sign type:** Illuminated / Non illuminated segmented control plus 6 tiles. Tapping one advances.
8. **Issues and notes:** 9 checkbox rows plus notes. "Save sign" shows a loading state.
9. **Success:** summary card, "Log another sign here" (reuses business and patrol type and skips step 6), "Done".
- **History:** session cards (date, time, patroller, h:mm, businesses/signs/photos).
- **Admin routes, create and history:** the Project A screens, restyled only.

## New data (read-only only)
The History tab, "last patrolled" on route cards, and the counts need data the app doesn't fetch yet.
- SELECT queries only. No writes, no schema or RLS changes.
- Filter by `organisation_id` and select only the columns you need.
- Paginate History at 20 per page. No per-row queries in loops; use one aggregate or nested-count query.
- The active-patrol business list must come from current session state, not a query.
- **List every new query with its purpose and wait for approval before implementing it.**

## Rules
- Touch targets ≥ 48 px. Honour `prefers-reduced-motion`.
- Test at 375 px wide in both themes.
- Handle loading, empty, error and success on every Supabase call. Show readable errors, never a silent catch.
- No refactors outside styling and layout. If you notice a bug, list it in the report and don't fix it.

## Done when
- `npm run build` gives 0 TypeScript errors and `npm test` passes.
- There is a Vercel preview for `feat/restyle`. Production is untouched.
- There is a report in `reports/` with: files changed, anything that differs from the mockup and why, and what you couldn't verify.
- There is a manual test list: run one full patrol (all 9 steps, twice at the same business) in day and night mode on a phone, then end it and check History, then run the admin create, archive and restore flow.

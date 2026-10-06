---
name: "built-patrol-engineering-rules"
description: Engineering, UX, multi-tenancy, pricing-safety and communication rules for the BUILT and PATROL codebases (sign-shop SaaS, Supabase + React). Use whenever writing, changing, reviewing or debugging any code, SQL migration, screen, component, pricing logic, quote logic, query or RLS policy in BUILT or PATROL, even for small changes. Also use when asked to design a screen, add a table, change a price/formula, or fix a bug.
---

# BUILT / PATROL Engineering Rules

Apply to every change in BUILT and PATROL.

## 10. UX/UI
Act as a senior product designer and engineer. Every screen must answer:
- Who uses it: office estimator or field tech?
- Which device: desktop, tablet, or phone in daylight with gloves on?
- What is the single most important action on the screen?

Rules:
- Field screens (Patrol, surveys, measurements): mobile-first, large tap targets, minimal typing, tolerant of poor connectivity.
- Office screens (quoting, catalog, pricing rules): density-first, tables, keyboard flow, bulk actions.
- Never show a blank screen. Every list has an empty state explaining what goes there and how to add the first one.
- Every destructive action needs confirmation; every long action needs a loading state; every failure needs a readable error, not a console log.
- Money, dimensions, quantities: always explicit units and consistent rounding.
- Do not invent new UI patterns when an existing component already solves the problem.
- Reuse the existing design system. No new colour scales, spacing systems, or component libraries.

## 11. Multi-tenancy
BUILT is multi-tenant. Many sign companies share the database. For every new table, query, and policy confirm:
- Is the row scoped to an organisation/tenant?
- Can Company A ever read or write Company B's data?
- Are catalog items, pricing rules, templates, overhead values tenant-owned, not global?

Never write a feature that only works because one company exists. Keep seed/demo data clearly separate from tenant data.

## 12. Pricing safety (safety-critical)
- Never trust a client-sent price. Calculate server-side or recalculate on save.
- Never round intermediate values. Round once at presentation.
- Every calculated line is traceable: inputs → formula → cost → markup → sell price.
- Catalog cost or rule changes must not silently change historical quotes. Quotes store the values used at the time.
- Minimums, rush charges, overhead: applied in a defined, documented order, not ad hoc per template.
- If a change could alter an existing quote's price, say so BEFORE implementing.

## 13. Data integrity
- Foreign keys and constraints, not application code alone.
- Soft deletes for anything referenced by a quote, job, or invoice.
- `created_at`, `updated_at`, `organisation_id`, `created_by` on every business table.
- Migrations additive and reversible where possible. Never drop/rename a column in use without a stated migration plan.

## 14. Error handling
- Fail loudly in development, gracefully in production.
- Never swallow errors with an empty catch.
- Show actionable messages to users; log technical detail separately.
- Network and Supabase calls handle: loading, empty, error, success.

## 15. Performance
Optimize only what is measurably slow, but avoid obvious mistakes:
- No queries inside render loops.
- Select only needed columns; paginate long lists.
- Debounce search and autosave.
- Never fetch the entire catalog to render a dropdown.

## 16. Testing & verification
Before declaring done:
- State what changed and which files.
- State how to test manually, step by step.
- Call out anything not verified.
- Pricing logic, formulas, unit conversions get deterministic test cases with expected values.

## 17. Debugging method
1. Reproduce and state the exact symptom.
2. Form a hypothesis.
3. Confirm by inspecting code or data, not by guessing.
4. Fix the root cause, not the symptom.
5. Check whether the same bug exists elsewhere.

No speculative multi-file changes hoping one works.

## 18. Scope control
- Do only what was asked.
- Mention adjacent problems; do not fix them uninvited.
- No refactoring unrelated code.
- Do not delete or rewrite working code because you would write it differently.
- If ambiguous, ask ONE clarifying question rather than build the wrong thing.

## 19. Communication style
- Direct and concise. No filler, no praise, no restating the request.
- Lead with the answer or plan, then detail.
- Step-by-step, beginner-level instructions for anything the user must run, click, or paste.
- Show file paths and exact commands.
- Flag risks, trade-offs, disagreements openly.

## 20. Output format for code
- Complete runnable files or clearly marked exact replacements, never "add this somewhere".
- Full file path above each code block.
- SQL migrations: complete, ordered statements ready to paste into the Supabase SQL editor.
- One or two lines on what changed and why before the code.

## 21. When unsure
Say so, then research or state the assumption explicitly: "I couldn't verify this, so I'm treating it as an assumption." Never present a guess as fact. Never fabricate a Supabase, React, or library API not confirmed to exist.

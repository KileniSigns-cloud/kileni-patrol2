// The sign issues a patroller can tick, shared by route patrol (IssuesPage) and Quick Catch so
// the two screens can't drift apart. BUILT maps these texts to a suggested service
// (suggestService in BUILT's src/lib/utils.ts), so a wording change here needs a change there.

export const ISSUES = [
  'Damaged / Impact damage',
  'Loose / Structurally unsafe',
  'Falling / Leaning',
  'Partially lit',
  'Fully dark / Not illuminated',
  'Peeling graphics',
  'Faded / Sun bleached',
  'Missing letters or elements',
  'Other',
] as const;

/** A "no issues" choice can't be combined with real issues. The list has none today. */
const isExclusive = (issue: string) => /^(none|no issues?)$/i.test(issue.trim());

/**
 * The selection after tapping `issue`: added if it wasn't ticked, removed if it was. Always in
 * list order, whatever order they were tapped in. Ticking a "none" choice clears the others and
 * ticking anything else clears it. A value that isn't on the list changes nothing.
 */
export function toggleIssue(selected: readonly string[], issue: string, list: readonly string[] = ISSUES): string[] {
  if (!list.includes(issue)) return list.filter((i) => selected.includes(i));
  const next = selected.includes(issue)
    ? selected.filter((i) => i !== issue)
    : isExclusive(issue) ? [issue] : [...selected.filter((i) => !isExclusive(i)), issue];
  return list.filter((i) => next.includes(i));
}

export type CheckedIssues = { ok: true; issues: string[] } | { ok: false; error: string };

/**
 * The selection as it may be saved: only values from the fixed list, each once, in list order.
 * Anything else (free text, a stale value) is refused rather than dropped, so nothing is saved
 * that the patroller didn't see ticked.
 */
export function checkIssues(selected: readonly unknown[], list: readonly string[] = ISSUES): CheckedIssues {
  const unknown = selected.filter((i) => typeof i !== 'string' || !list.includes(i));
  if (unknown.length > 0) return { ok: false, error: 'Not saved: an issue is not on the list. Untick the issues and tick them again.' };
  if (new Set(selected).size !== selected.length) return { ok: false, error: 'Not saved: an issue is ticked twice. Untick the issues and tick them again.' };
  return { ok: true, issues: list.filter((i) => selected.includes(i)) };
}

/** The lead's issue_type: the issues joined with ", " (as the route patrol lead trigger does), or null. */
export const issueTypeText = (issues: readonly string[]): string | null => issues.join(', ') || null;

/**
 * Quick Catch: the issues a save attempt uses. A retry after the inspection record was saved
 * reuses the issues saved with it, so the record and the lead always agree; a first attempt
 * checks the current selection.
 */
export const issuesForAttempt = (saved: readonly string[] | null, selected: readonly unknown[]): CheckedIssues =>
  saved ? { ok: true, issues: [...saved] } : checkIssues(selected);

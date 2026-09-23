// Pure rules for the per-sign flow (photos -> patrol type -> sign type -> issues -> save).
// No React or Supabase here, so tests/signFlow.test.ts can exercise them directly.

export type PatrolType = 'day' | 'night';

/** The part of the patrol session that describes the sign being logged. */
export interface SignDraft {
  businessId: string | null;
  businessName: string | null;
  patrolType: PatrolType | null;
  signCategory: string | null;
  signType: string | null;
  inspectionId: string | null;
  signPhotoUrls: string[];
  surroundingPhotoUrls: string[];
  currentIssues: string[];
  currentNotes: string;
  /** True after "Log another sign here": same business, patrol type already known. */
  reusingBusiness: boolean;
}

/**
 * State for the next sign at the same business. Keeps the business and patrol type,
 * clears everything about the previous sign.
 */
export function resetForNextSign(d: SignDraft): SignDraft {
  return {
    businessId: d.businessId,
    businessName: d.businessName,
    patrolType: d.patrolType,
    signCategory: null,
    signType: null,
    inspectionId: null,
    signPhotoUrls: [],
    surroundingPhotoUrls: [],
    currentIssues: [],
    currentNotes: '',
    reusingBusiness: d.patrolType !== null,
  };
}

/** Step 6 (patrol type) is skipped when the patrol type was kept from the previous sign. */
export const skipsPatrolType = (d: Pick<SignDraft, 'reusingBusiness' | 'patrolType'>) =>
  d.reusingBusiness && d.patrolType !== null;

export function getSeverity(count: number): string {
  if (count === 0) return 'excellent';
  if (count <= 2) return 'good';
  if (count <= 4) return 'fair';
  if (count <= 6) return 'poor';
  return 'critical';
}

const ORG_ID = '8239bb55-2423-43c1-bb54-6370765f2275';

export type InspectionInsertResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * The sign_inspections row for the current sign, or a readable reason it can't be saved.
 * Field-for-field the insert IssuesPage has always made.
 */
export function buildSignInspectionInsert(
  d: SignDraft,
  user: { id: string; email: string } | null,
  notes: string,
  nowIso: string,
): InspectionInsertResult {
  if (!user) return { ok: false, error: 'You are signed out. Sign in again to save this sign.' };
  if (!d.businessId) {
    return { ok: false, error: 'This sign has no business attached. Go back to the patrol and add the business again.' };
  }
  const issues = d.currentIssues;
  return {
    ok: true,
    row: {
      business_id: d.businessId,
      organisation_id: ORG_ID,
      business_name: d.businessName || null,
      sign_category: d.signCategory,
      sign_type: d.signType,
      patrol_type: d.patrolType,
      condition: issues,
      condition_rating: getSeverity(issues.length),
      is_compliant: issues.length === 0,
      non_compliance_reason: issues.join(', ') || null,
      notes: notes || null,
      status: 'completed',
      inspected_by: user.id || null,
      patroller_name: user.email || null,
      inspected_at: nowIso,
      date_logged: nowIso,
    },
  };
}

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

/**
 * State for a new business ("Add business" on Active patrol): nothing from the previous
 * business or sign carries over except the patrol type (day/night), as before.
 */
export function draftForNewBusiness(patrolType: PatrolType | null): SignDraft {
  return {
    businessId: null,
    businessName: null,
    patrolType,
    signCategory: null,
    signType: null,
    inspectionId: null,
    signPhotoUrls: [],
    surroundingPhotoUrls: [],
    currentIssues: [],
    currentNotes: '',
    reusingBusiness: false,
  };
}

/** A business logged on the current patrol, as listed on the Active patrol screen. */
export interface LoggedBusiness {
  id: string;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** Prefills the Business step when it is revisited. */
  notes?: string | null;
  signs: number;
  /** Patrol type of the last sign saved here on this device; null after a rebuild on resume. */
  lastPatrolType: PatrolType | null;
}

/** Adds a newly saved business (ignored if it's already listed). */
export function withBusinessAdded(list: readonly LoggedBusiness[], b: LoggedBusiness): LoggedBusiness[] {
  return list.some((x) => x.id === b.id) ? [...list] : [...list, b];
}

/** Replaces an edited business's details in place; its sign count and patrol type are kept. */
export function withBusinessUpdated(
  list: readonly LoggedBusiness[],
  b: Pick<LoggedBusiness, 'id' | 'name' | 'address' | 'lat' | 'lng' | 'notes'>,
): LoggedBusiness[] {
  return list.map((x) =>
    x.id === b.id ? { ...x, name: b.name, address: b.address, lat: b.lat, lng: b.lng, notes: b.notes } : x,
  );
}

/** The signed-in user as the save steps need it (organisation from public.users). */
export interface SavingUser {
  id: string;
  email: string;
  organisation_id: string;
}

const noOrganisation = (what: 'Sign' | 'Business') =>
  `${what} not saved: your account has no organisation. Ask an admin to add you to one.`;

/** What the Business step form holds when Save is tapped. */
export interface BusinessForm {
  name: string;
  address: string;
  notes: string;
  lat: number | null;
  lng: number | null;
}

export type BusinessWrite =
  | { ok: true; mode: 'insert'; row: Record<string, unknown> }
  | { ok: true; mode: 'update'; id: string; row: Record<string, unknown> }
  | { ok: true; mode: 'unchanged'; id: string }
  | { ok: false; error: string };

const blankToNull = (s: string) => s.trim() || null;

/**
 * The patrol_businesses write for the Business step. `existing` is the business this flow
 * already saved (the step was revisited with Back): it is updated in place, or left alone
 * when nothing changed, so going back and saving again never creates a second business.
 * A new business carries rep_id: the UPDATE policies require rep_id = auth.uid().
 */
export function buildBusinessWrite(
  form: BusinessForm,
  existing: LoggedBusiness | null,
  sessionId: string,
  user: SavingUser | null,
  nowIso: string,
): BusinessWrite {
  if (!user?.id) return { ok: false, error: 'You are signed out. Sign in again to save this business.' };
  if (!user.organisation_id) return { ok: false, error: noOrganisation('Business') };

  const details = { name: blankToNull(form.name), address: blankToNull(form.address), notes: blankToNull(form.notes) };
  const located = form.lat !== null && form.lng !== null;
  const gps = {
    lat: form.lat,
    lng: form.lng,
    gps_latitude: form.lat,
    gps_longitude: form.lng,
    gps_captured_at: located ? nowIso : null,
  };

  if (existing) {
    const moved = form.lat !== existing.lat || form.lng !== existing.lng;
    const unchanged =
      !moved &&
      details.name === existing.name &&
      details.address === existing.address &&
      details.notes === (existing.notes ?? null);
    if (unchanged) return { ok: true, mode: 'unchanged', id: existing.id };
    return { ok: true, mode: 'update', id: existing.id, row: moved ? { ...details, ...gps } : details };
  }

  return {
    ok: true,
    mode: 'insert',
    row: {
      session_id: sessionId,
      organisation_id: user.organisation_id,
      rep_id: user.id,
      ...details,
      ...gps,
      date_added: nowIso,
      type: 'existing',
    },
  };
}

/** Counts a saved sign against its business and remembers the patrol type used. */
export function withSignSaved(
  list: readonly LoggedBusiness[],
  businessId: string,
  patrolType: PatrolType | null,
): LoggedBusiness[] {
  return list.map((b) =>
    b.id === businessId ? { ...b, signs: b.signs + 1, lastPatrolType: patrolType ?? b.lastPatrolType } : b,
  );
}

/**
 * Draft for logging another sign at a business picked from the Active patrol list:
 * same as "Log another sign here", using the patrol type last used at that business.
 */
export function draftForExistingBusiness(b: LoggedBusiness): SignDraft {
  return resetForNextSign({
    businessId: b.id,
    businessName: b.name,
    patrolType: b.lastPatrolType,
    signCategory: null,
    signType: null,
    inspectionId: null,
    signPhotoUrls: [],
    surroundingPhotoUrls: [],
    currentIssues: [],
    currentNotes: '',
    reusingBusiness: false,
  });
}

/** Whole seconds since startedAt (never negative, e.g. with a slightly fast server clock). */
export const secondsSince = (startedAtMs: number, nowMs: number) => Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));

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

/**
 * The id a sign's photos are filed under ({org}/patrol/{id}/…) and its row is inserted with.
 * Kept while the same sign's photos are retaken; null after a reset, so each sign gets a new one.
 */
export const ensureInspectionId = (current: string | null, newId: () => string): string => current ?? newId();

export type InspectionInsertResult =
  | { ok: true; inspectionId: string; row: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * The sign_inspections row for the current sign, or a readable reason it can't be saved.
 * The insert IssuesPage has always made, plus the id its uploaded photos are filed under.
 */
export function buildSignInspectionInsert(
  d: SignDraft,
  user: SavingUser | null,
  notes: string,
  nowIso: string,
): InspectionInsertResult {
  if (!user) return { ok: false, error: 'You are signed out. Sign in again to save this sign.' };
  if (!user.organisation_id) return { ok: false, error: noOrganisation('Sign') };
  if (!d.businessId) {
    return { ok: false, error: 'This sign has no business attached. Go back to the patrol and add the business again.' };
  }
  if (!d.inspectionId || d.signPhotoUrls.length === 0) {
    return { ok: false, error: 'Sign not saved: its photos were not uploaded. Go back to Photos and tap Next again.' };
  }
  const issues = d.currentIssues;
  return {
    ok: true,
    inspectionId: d.inspectionId,
    row: {
      id: d.inspectionId,
      business_id: d.businessId,
      organisation_id: user.organisation_id,
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

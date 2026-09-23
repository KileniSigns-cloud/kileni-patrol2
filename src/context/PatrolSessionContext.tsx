import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';
import {
  draftForExistingBusiness, resetForNextSign as nextSignDraft, secondsSince, withBusinessAdded, withSignSaved,
  type LoggedBusiness, type PatrolType, type SignDraft,
} from '../lib/signFlow';

interface StartSessionOptions {
  routeCode?: string | null;
  /** ISO start time; when resuming, the timer continues from here instead of 0. */
  startedAt?: string;
}

interface PatrolSessionContextType {
  // State (spec)
  sessionId: string | null;
  routeId: string | null;
  routeName: string | null;
  routeCode: string | null;
  /** Epoch ms the session started (from patrol_sessions.started_at when resumed). */
  sessionStartedAt: number | null;
  businessId: string | null;
  businessName: string | null;
  patrolType: 'day' | 'night' | null;
  signCategory: string | null;
  signType: string | null;
  inspectionId: string | null;
  signPhotoUrls: string[];
  surroundingPhotoUrls: string[];
  // Extra state needed by consumers
  elapsedSeconds: number;
  currentIssues: string[];
  currentNotes: string;
  /** True after "Log another sign here": same business, patrol type kept, step 6 skipped. */
  reusingBusiness: boolean;
  /** Businesses logged on this patrol (rebuilt from the DB when a patrol is resumed). */
  loggedBusinesses: LoggedBusiness[];
  // Setters (spec)
  setSessionId: (id: string | null) => void;
  setRouteId: (id: string | null) => void;
  setRouteName: (name: string | null) => void;
  setBusinessId: (id: string | null) => void;
  setBusinessName: (name: string | null) => void;
  setPatrolType: (type: 'day' | 'night') => void;
  setSignCategory: (category: string | null) => void;
  setSignType: (type: string | null) => void;
  setInspectionId: (id: string | null) => void;
  setSignPhotoUrls: (urls: string[]) => void;
  setSurroundingPhotoUrls: (urls: string[]) => void;
  // Convenience setters for consumers
  setPhotoUrls: (signUrls: string[], surroundingUrls: string[]) => void;
  setIssues: (issues: string[]) => void;
  setNotes: (notes: string) => void;
  // Session lifecycle
  startSession: (sessionId: string, routeId: string, routeName: string, opts?: StartSessionOptions) => void;
  addLoggedBusiness: (b: LoggedBusiness) => void;
  recordSignSaved: (businessId: string, patrolType: PatrolType | null) => void;
  setLoggedBusinesses: (list: LoggedBusiness[]) => void;
  /** Start a new sign at a business from the Active patrol list (skips step 6 when its patrol type is known). */
  startSignAtBusiness: (b: LoggedBusiness) => void;
  endSession: () => void;
  resetInspection: () => void;
  resetForNextSign: () => void;
}

const PatrolSessionContext = createContext<PatrolSessionContextType | null>(null);

export const PatrolSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [routeName, setRouteName] = useState<string | null>(null);
  const [routeCode, setRouteCode] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [loggedBusinesses, setLoggedBusinesses] = useState<LoggedBusiness[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [patrolType, setPatrolType] = useState<'day' | 'night' | null>(null);
  const [signCategory, setSignCategory] = useState<string | null>(null);
  const [signType, setSignType] = useState<string | null>(null);
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [signPhotoUrls, setSignPhotoUrls] = useState<string[]>([]);
  const [surroundingPhotoUrls, setSurroundingPhotoUrls] = useState<string[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentIssues, setCurrentIssues] = useState<string[]>([]);
  const [currentNotes, setCurrentNotes] = useState('');
  const [reusingBusiness, setReusingBusiness] = useState(false);

  // A newly saved business starts a fresh sign flow, so it is never "reused".
  const setBusinessIdForNewBusiness = useCallback((id: string | null) => {
    setBusinessId(id);
    setReusingBusiness(false);
  }, []);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

  const startSession = useCallback((sid: string, rid: string, rname: string, opts: StartSessionOptions = {}) => {
    const parsed = opts.startedAt ? Date.parse(opts.startedAt) : NaN;
    const startMs = Number.isFinite(parsed) ? parsed : Date.now();
    setSessionId(sid);
    setRouteId(rid);
    setRouteName(rname);
    setRouteCode(opts.routeCode ?? null);
    setSessionStartedAt(startMs);
    setLoggedBusinesses([]);
    setBusinessId(null);
    setBusinessName(null);
    setPatrolType(null);
    setSignCategory(null);
    setSignType(null);
    setInspectionId(null);
    setSignPhotoUrls([]);
    setSurroundingPhotoUrls([]);
    setCurrentIssues([]);
    setCurrentNotes('');
    setReusingBusiness(false);
    // Elapsed time is derived from the start time, so it stays right after a resume
    // and doesn't drift when the tab is throttled in the background.
    setElapsedSeconds(secondsSince(startMs, Date.now()));
    stopTimer();
    timerRef.current = setInterval(() => setElapsedSeconds(secondsSince(startMs, Date.now())), 1000);
  }, [stopTimer]);

  const endSession = useCallback(() => {
    stopTimer();
    setSessionId(null);
    setRouteId(null);
    setRouteName(null);
    setRouteCode(null);
    setSessionStartedAt(null);
    setLoggedBusinesses([]);
    setBusinessId(null);
    setBusinessName(null);
    setPatrolType(null);
    setSignCategory(null);
    setSignType(null);
    setInspectionId(null);
    setSignPhotoUrls([]);
    setSurroundingPhotoUrls([]);
    setElapsedSeconds(0);
    setCurrentIssues([]);
    setCurrentNotes('');
    setReusingBusiness(false);
  }, [stopTimer]);

  const resetInspection = useCallback(() => {
    setBusinessId(null);
    setBusinessName(null);
    setSignCategory(null);
    setSignType(null);
    setInspectionId(null);
    setSignPhotoUrls([]);
    setSurroundingPhotoUrls([]);
    setCurrentIssues([]);
    setCurrentNotes('');
    // sessionId, routeId, routeName, patrolType are preserved
  }, []);

  const applyDraft = useCallback((d: SignDraft) => {
    setBusinessId(d.businessId);
    setBusinessName(d.businessName);
    setPatrolType(d.patrolType);
    setSignCategory(d.signCategory);
    setSignType(d.signType);
    setInspectionId(d.inspectionId);
    setSignPhotoUrls(d.signPhotoUrls);
    setSurroundingPhotoUrls(d.surroundingPhotoUrls);
    setCurrentIssues(d.currentIssues);
    setCurrentNotes(d.currentNotes);
    setReusingBusiness(d.reusingBusiness);
  }, []);

  const startSignAtBusiness = useCallback((b: LoggedBusiness) => applyDraft(draftForExistingBusiness(b)), [applyDraft]);
  const addLoggedBusiness = useCallback((b: LoggedBusiness) => setLoggedBusinesses(list => withBusinessAdded(list, b)), []);
  const recordSignSaved = useCallback(
    (id: string, type: PatrolType | null) => setLoggedBusinesses(list => withSignSaved(list, id, type)),
    [],
  );

  // "Log another sign here": keep the business and patrol type, clear the previous sign.
  const resetForNextSign = useCallback(() => {
    const next = nextSignDraft({
      businessId, businessName, patrolType, signCategory, signType, inspectionId,
      signPhotoUrls, surroundingPhotoUrls, currentIssues, currentNotes, reusingBusiness,
    });
    applyDraft(next);
  }, [businessId, businessName, patrolType, signCategory, signType, inspectionId,
      signPhotoUrls, surroundingPhotoUrls, currentIssues, currentNotes, reusingBusiness, applyDraft]);

  const setPhotoUrls = useCallback((signUrls: string[], surroundingUrls: string[]) => {
    setSignPhotoUrls(signUrls);
    setSurroundingPhotoUrls(surroundingUrls);
  }, []);

  const setIssues = useCallback((issues: string[]) => setCurrentIssues(issues), []);
  const setNotes = useCallback((notes: string) => setCurrentNotes(notes), []);

  return (
    <PatrolSessionContext.Provider value={{
      sessionId, routeId, routeName, routeCode, sessionStartedAt, businessId, businessName,
      patrolType, signCategory, signType, inspectionId,
      signPhotoUrls, surroundingPhotoUrls,
      elapsedSeconds, currentIssues, currentNotes, reusingBusiness, loggedBusinesses,
      setSessionId, setRouteId, setRouteName, setBusinessId: setBusinessIdForNewBusiness, setBusinessName,
      setPatrolType, setSignCategory, setSignType, setInspectionId,
      setSignPhotoUrls, setSurroundingPhotoUrls,
      setPhotoUrls, setIssues, setNotes,
      startSession, endSession, resetInspection,
      resetForNextSign,
      addLoggedBusiness, recordSignSaved, setLoggedBusinesses, startSignAtBusiness,
    }}>
      {children}
    </PatrolSessionContext.Provider>
  );
};

export const usePatrolSession = () => {
  const ctx = useContext(PatrolSessionContext);
  if (!ctx) throw new Error('usePatrolSession must be used within PatrolSessionProvider');
  return ctx;
};

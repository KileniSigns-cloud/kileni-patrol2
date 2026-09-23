import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';
import { resetForNextSign as nextSignDraft } from '../lib/signFlow';

interface PatrolSessionContextType {
  // State (spec)
  sessionId: string | null;
  routeId: string | null;
  routeName: string | null;
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
  startSession: (sessionId: string, routeId: string, routeName: string) => void;
  endSession: () => void;
  resetInspection: () => void;
  resetForNextSign: () => void;
}

const PatrolSessionContext = createContext<PatrolSessionContextType | null>(null);

export const PatrolSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [routeName, setRouteName] = useState<string | null>(null);
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

  const startSession = useCallback((sid: string, rid: string, rname: string) => {
    setSessionId(sid);
    setRouteId(rid);
    setRouteName(rname);
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
    setElapsedSeconds(0);
    stopTimer();
    timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
  }, [stopTimer]);

  const endSession = useCallback(() => {
    stopTimer();
    setSessionId(null);
    setRouteId(null);
    setRouteName(null);
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

  // "Log another sign here": keep the business and patrol type, clear the previous sign.
  const resetForNextSign = useCallback(() => {
    const next = nextSignDraft({
      businessId, businessName, patrolType, signCategory, signType, inspectionId,
      signPhotoUrls, surroundingPhotoUrls, currentIssues, currentNotes, reusingBusiness,
    });
    setBusinessId(next.businessId);
    setBusinessName(next.businessName);
    setPatrolType(next.patrolType);
    setSignCategory(next.signCategory);
    setSignType(next.signType);
    setInspectionId(next.inspectionId);
    setSignPhotoUrls(next.signPhotoUrls);
    setSurroundingPhotoUrls(next.surroundingPhotoUrls);
    setCurrentIssues(next.currentIssues);
    setCurrentNotes(next.currentNotes);
    setReusingBusiness(next.reusingBusiness);
  }, [businessId, businessName, patrolType, signCategory, signType, inspectionId,
      signPhotoUrls, surroundingPhotoUrls, currentIssues, currentNotes, reusingBusiness]);

  const setPhotoUrls = useCallback((signUrls: string[], surroundingUrls: string[]) => {
    setSignPhotoUrls(signUrls);
    setSurroundingPhotoUrls(surroundingUrls);
  }, []);

  const setIssues = useCallback((issues: string[]) => setCurrentIssues(issues), []);
  const setNotes = useCallback((notes: string) => setCurrentNotes(notes), []);

  return (
    <PatrolSessionContext.Provider value={{
      sessionId, routeId, routeName, businessId, businessName,
      patrolType, signCategory, signType, inspectionId,
      signPhotoUrls, surroundingPhotoUrls,
      elapsedSeconds, currentIssues, currentNotes, reusingBusiness,
      setSessionId, setRouteId, setRouteName, setBusinessId: setBusinessIdForNewBusiness, setBusinessName,
      setPatrolType, setSignCategory, setSignType, setInspectionId,
      setSignPhotoUrls, setSurroundingPhotoUrls,
      setPhotoUrls, setIssues, setNotes,
      startSession, endSession, resetInspection,
      resetForNextSign,
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

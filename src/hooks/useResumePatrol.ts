import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePatrolStore } from '../store/patrol.store';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { fetchResumableSession, fetchSessionBusinesses, type ResumableSession } from '../lib/patrolApi';
import { getOrgId } from '../lib/routesApi';
import { toast } from '../components/ui/Toast';

type Lookup =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'found'; session: ResumableSession }
  | { status: 'error'; message: string };

/**
 * Finds the signed-in user's unfinished patrol from the last 12 hours (works after a page
 * refresh, since it reads the database) and resumes it into the in-memory session.
 * Read-only: resuming never writes.
 */
export function useResumePatrol(enabled: boolean) {
  const navigate = useNavigate();
  const userId = usePatrolStore((s) => s.currentUser?.id);
  const setActiveSession = usePatrolStore((s) => s.setActiveSession);
  const { startSession, setLoggedBusinesses } = usePatrolSession();
  const [lookup, setLookup] = useState<Lookup>({ status: 'loading' });

  const check = useCallback(async () => {
    if (!userId) return;
    setLookup({ status: 'loading' });
    try {
      const session = await fetchResumableSession(userId, Date.now());
      setLookup(session ? { status: 'found', session } : { status: 'none' });
    } catch (e) {
      setLookup({ status: 'error', message: e instanceof Error ? e.message : 'Could not check for an unfinished patrol.' });
    }
  }, [userId]);

  useEffect(() => { if (enabled) check(); }, [enabled, check]);

  const resume = useCallback(async (s: Pick<ResumableSession, 'id' | 'route_id' | 'started_at' | 'patrol_routes'>) => {
    startSession(s.id, s.route_id, s.patrol_routes?.name ?? 'Route', {
      routeCode: s.patrol_routes?.code ?? null,
      startedAt: s.started_at,
    });
    setActiveSession(s.id, s.route_id);
    try {
      setLoggedBusinesses(await fetchSessionBusinesses(s.id, await getOrgId()));
    } catch (e) {
      toast.error(`Patrol resumed, but its business list didn't load. ${e instanceof Error ? e.message : ''}`.trim());
    }
    navigate(`/patrol/${s.id}`);
  }, [startSession, setActiveSession, setLoggedBusinesses, navigate]);

  return { lookup, check, resume };
}

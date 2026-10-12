import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../lib/supabase';
import * as routesApi from '../lib/routesApi';
import type { ZoneRow } from '../lib/zoneForm';
import type { RouteDeleteCheck } from '../lib/routeDelete';
import type { ImportPlan, ImportResponse, ImportRow } from '../lib/zoneImport';
import type { ZoneInfoData } from '../lib/zoneInfo';
import { loadRecoveryFlag, saveRecoveryFlag } from '../lib/passwordRecovery';
import { findCachedZone, zoneInfoOf } from '../lib/zoneCache';
import type { PatrolRoute, User } from '../types';

interface PatrolStore {
  currentUser: User | null;
  /** True after a password-reset link signs the user in, until the new password is saved. Kept in sessionStorage, not localStorage. */
  passwordRecovery: boolean;
  setPasswordRecovery: (on: boolean) => void;
  routes: PatrolRoute[];
  routesLoading: boolean;
  routesError: string | null;
  activeSessionId: string | null;
  activeRouteId: string | null;
  pendingCount: number;
  setUser: (user: User | null) => void;
  loadRoutes: () => Promise<void>;
  logout: () => Promise<void>;
  setActiveSession: (sessionId: string, routeId: string) => void;
  clearActiveSession: () => void;
  setPendingCount: (count: number) => void;
  // Admin zone management (zones are patrol_routes rows). Each throws an Error with a readable message on failure.
  getActiveRoutes: () => Promise<routesApi.RouteWithStats[]>;
  getArchivedRoutes: () => Promise<PatrolRoute[]>;
  getZone: (routeId: string) => Promise<PatrolRoute>;
  createZone: (row: ZoneRow) => Promise<PatrolRoute>;
  updateZone: (routeId: string, row: ZoneRow) => Promise<PatrolRoute>;
  archiveRoute: (routeId: string) => Promise<void>;
  restoreRoute: (routeId: string) => Promise<void>;
  getRouteHistory: (routeId: string, page: number) => Promise<routesApi.RouteHistoryPage>;
  checkRouteDelete: (routeId: string) => Promise<RouteDeleteCheck>;
  deleteRoute: (routeId: string) => Promise<RouteDeleteCheck>;
  getRouteExport: (routeId: string) => Promise<routesApi.RouteExportData>;
  getZoneInfo: (routeId: string) => Promise<ZoneInfoData>;
  previewZoneImport: (rows: ImportRow[]) => Promise<ImportResponse>;
  /** Applies a previewed import, then refreshes the patrollers' zone list. */
  applyZoneImport: (rows: ImportRow[], fingerprint: string) => Promise<ImportPlan>;
}

export const usePatrolStore = create<PatrolStore>()(
  persist(
    (set, get) => ({
      currentUser: null,
      passwordRecovery: loadRecoveryFlag(),
      routes: [],
      routesLoading: false,
      routesError: null,
      activeSessionId: null,
      activeRouteId: null,
      pendingCount: 0,

      setUser: (user) => set({ currentUser: user }),

      setPasswordRecovery: (on) => {
        saveRecoveryFlag(on);
        set({ passwordRecovery: on });
      },

      loadRoutes: async () => {
        set({ routesLoading: true, routesError: null });
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { set({ routesLoading: false }); return; }

        const { data: userData } = await supabase
          .from('users')
          .select('organisation_id')
          .eq('id', user.id)
          .single();

        if (!userData) { set({ routesLoading: false, routesError: 'User profile not found.' }); return; }

        const { data, error } = await supabase
          .from('patrol_routes')
          .select('*')
          .eq('organisation_id', userData.organisation_id)
          .is('archived_at', null)
          .order('name');

        if (error) {
          set({ routesLoading: false, routesError: error.message });
        } else {
          set({ routes: data ?? [], routesLoading: false });
        }
      },

      logout: async () => {
        await supabase.auth.signOut();
        saveRecoveryFlag(false);
        set({ currentUser: null, passwordRecovery: false, routes: [], activeSessionId: null, activeRouteId: null });
      },

      setActiveSession: (sessionId, routeId) =>
        set({ activeSessionId: sessionId, activeRouteId: routeId }),

      clearActiveSession: () =>
        set({ activeSessionId: null, activeRouteId: null }),

      setPendingCount: (count) => set({ pendingCount: count }),

      getActiveRoutes: async () => routesApi.fetchActiveRoutesWithStats(await routesApi.getOrgId()),
      getArchivedRoutes: async () => routesApi.fetchArchivedRoutes(await routesApi.getOrgId()),
      getRouteHistory: (routeId, page) => routesApi.fetchRouteHistory(routeId, page),
      checkRouteDelete: (routeId) => routesApi.checkRouteDelete(routeId),
      getRouteExport: (routeId) => routesApi.fetchRouteExport(routeId),
      getZone: (routeId) => routesApi.fetchRoute(routeId),
      getZoneInfo: async (routeId) => {
        try {
          return await routesApi.fetchZoneInfo(routeId);
        } catch (err) {
          // No signal mid-patrol: the Zone info sheet reads the copy saved with the Zones list.
          const orgId = get().currentUser?.organisation_id;
          const saved = orgId ? findCachedZone(localStorage, orgId, routeId) : null;
          if (saved) return zoneInfoOf(saved);
          throw err;
        }
      },
      previewZoneImport: (rows) => routesApi.previewZoneImport(rows),

      // Mutations refresh the patroller-facing route list so it never shows stale routes.
      createZone: async (row) => {
        const zone = await routesApi.createZone(row);
        await get().loadRoutes();
        return zone;
      },
      updateZone: async (routeId, row) => {
        const zone = await routesApi.updateZone(routeId, row);
        await get().loadRoutes();
        return zone;
      },
      archiveRoute: async (routeId) => {
        await routesApi.archiveRoute(routeId);
        await get().loadRoutes();
      },
      restoreRoute: async (routeId) => {
        await routesApi.restoreRoute(routeId);
        await get().loadRoutes();
      },
      applyZoneImport: async (rows, fingerprint) => {
        const plan = await routesApi.applyZoneImport(rows, fingerprint);
        await get().loadRoutes();
        return plan;
      },
      deleteRoute: async (routeId) => {
        const result = await routesApi.deleteRouteIfUnused(routeId);
        if (result.status === 'deleted') await get().loadRoutes();
        return result;
      },
    }),
    {
      name: 'patrol-store',
      partialize: (state) => ({
        currentUser: state.currentUser,
        routes: state.routes,
        activeSessionId: state.activeSessionId,
        activeRouteId: state.activeRouteId,
        pendingCount: state.pendingCount,
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        routes: Array.isArray(persisted?.routes) ? persisted.routes : [],
      }),
    }
  )
);

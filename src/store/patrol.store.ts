import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../lib/supabase';
import * as routesApi from '../lib/routesApi';
import type { RouteFormValues } from '../lib/routeForm';
import type { PatrolRoute, User } from '../types';

interface PatrolStore {
  currentUser: User | null;
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
  // Admin route management. Each throws an Error with a readable message on failure.
  getActiveRoutes: () => Promise<routesApi.RouteWithStats[]>;
  getArchivedRoutes: () => Promise<PatrolRoute[]>;
  createRoute: (values: RouteFormValues) => Promise<PatrolRoute>;
  archiveRoute: (routeId: string) => Promise<void>;
  restoreRoute: (routeId: string) => Promise<void>;
  getRouteHistory: (routeId: string, page: number) => Promise<routesApi.RouteHistoryPage>;
}

export const usePatrolStore = create<PatrolStore>()(
  persist(
    (set, get) => ({
      currentUser: null,
      routes: [],
      routesLoading: false,
      routesError: null,
      activeSessionId: null,
      activeRouteId: null,
      pendingCount: 0,

      setUser: (user) => set({ currentUser: user }),

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
        set({ currentUser: null, routes: [], activeSessionId: null, activeRouteId: null });
      },

      setActiveSession: (sessionId, routeId) =>
        set({ activeSessionId: sessionId, activeRouteId: routeId }),

      clearActiveSession: () =>
        set({ activeSessionId: null, activeRouteId: null }),

      setPendingCount: (count) => set({ pendingCount: count }),

      getActiveRoutes: async () => routesApi.fetchActiveRoutesWithStats(await routesApi.getOrgId()),
      getArchivedRoutes: async () => routesApi.fetchArchivedRoutes(await routesApi.getOrgId()),
      getRouteHistory: (routeId, page) => routesApi.fetchRouteHistory(routeId, page),

      // Mutations refresh the patroller-facing route list so it never shows stale routes.
      createRoute: async (values) => {
        const route = await routesApi.createRoute(values);
        await get().loadRoutes();
        return route;
      },
      archiveRoute: async (routeId) => {
        await routesApi.archiveRoute(routeId);
        await get().loadRoutes();
      },
      restoreRoute: async (routeId) => {
        await routesApi.restoreRoute(routeId);
        await get().loadRoutes();
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

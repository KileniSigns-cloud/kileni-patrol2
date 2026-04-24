import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../lib/supabase';
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
}

export const usePatrolStore = create<PatrolStore>()(
  persist(
    (set) => ({
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

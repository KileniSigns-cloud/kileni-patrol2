import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { User } from './types';
import { supabase } from './lib/supabase';
import { usePatrolStore } from './store/patrol.store';
import { PatrolSessionProvider } from './context/PatrolSessionContext';
import { ThemeProvider } from './context/ThemeContext';
import LoginPage from './pages/LoginPage';
import RoutesPage from './pages/RoutesPage';
import RoutePreviewPage from './pages/RoutePreviewPage';
import ActivePatrolPage from './pages/ActivePatrolPage';
import AddBusinessPage from './pages/AddBusinessPage';
import PhotoUploadPage from './pages/PhotoUploadPage';
import PatrolTypePage from './pages/PatrolTypePage';
import SignTypePage from './pages/SignTypePage';
import SignConditionPage from './pages/SignConditionPage';
import IssuesPage from './pages/IssuesPage';
import SuccessPage from './pages/SuccessPage';
import QuickCatchPage from './pages/QuickCatchPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import AdminRoutesPage from './pages/AdminRoutesPage';
import CreateRouteFormPage from './pages/CreateRouteFormPage';
import RouteHistoryPage from './pages/RouteHistoryPage';
import ProtectedRoute from './components/ProtectedRoute';
import { Toaster } from './components/ui/Toast';

const AppLayout: React.FC<{ currentUser: User | null }> = ({ currentUser }) => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/routes" element={currentUser ? <RoutesPage /> : <Navigate to="/login" replace />} />
    <Route path="/quick-catch" element={currentUser ? <QuickCatchPage /> : <Navigate to="/login" replace />} />
    <Route path="/admin" element={currentUser ? <AdminPage /> : <Navigate to="/login" replace />} />
    <Route path="/admin/routes" element={<ProtectedRoute adminOnly><AdminRoutesPage /></ProtectedRoute>} />
    <Route path="/admin/routes/create" element={<ProtectedRoute adminOnly><CreateRouteFormPage /></ProtectedRoute>} />
    <Route path="/admin/routes/:routeId/history" element={<ProtectedRoute adminOnly><RouteHistoryPage /></ProtectedRoute>} />
    <Route path="/profile" element={currentUser ? <ProfilePage /> : <Navigate to="/login" replace />} />
    <Route path="/route/:routeId" element={currentUser ? <RoutePreviewPage /> : <Navigate to="/login" replace />} />
    <Route path="/patrol/:sessionId" element={currentUser ? <ActivePatrolPage /> : <Navigate to="/login" replace />} />
    <Route path="/add-business/:sessionId" element={currentUser ? <AddBusinessPage /> : <Navigate to="/login" replace />} />
    <Route path="/photos/:sessionId" element={currentUser ? <PhotoUploadPage /> : <Navigate to="/login" replace />} />
    <Route path="/patrol-type/:sessionId" element={currentUser ? <PatrolTypePage /> : <Navigate to="/login" replace />} />
    <Route path="/sign-type/:sessionId" element={currentUser ? <SignTypePage /> : <Navigate to="/login" replace />} />
    <Route path="/sign-condition/:sessionId" element={currentUser ? <SignConditionPage /> : <Navigate to="/login" replace />} />
    <Route path="/issues/:sessionId" element={currentUser ? <IssuesPage /> : <Navigate to="/login" replace />} />
    <Route path="/success/:sessionId" element={currentUser ? <SuccessPage /> : <Navigate to="/login" replace />} />
    <Route path="*" element={<Navigate to={currentUser ? '/routes' : '/login'} replace />} />
  </Routes>
);

const App: React.FC = () => {
  const { currentUser, setUser } = usePatrolStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 5000);

    // Signed-in user from the auth session, then role + organisation from public.users.
    // The role is kept across token refreshes so admin screens don't flash "Checking access".
    const applySession = (session: Session | null) => {
      if (!session?.user) {
        setUser(null);
        return;
      }
      const authUser = session.user;
      const prev = usePatrolStore.getState().currentUser;
      setUser({
        id: authUser.id,
        email: authUser.email ?? '',
        name: authUser.user_metadata?.name,
        organisation_id: authUser.user_metadata?.organisation_id ?? '',
        role: prev?.id === authUser.id ? prev.role : undefined,
      });
      supabase
        .from('users')
        .select('organisation_id, role')
        .eq('id', authUser.id)
        .single()
        .then(({ data, error }) => {
          const current = usePatrolStore.getState().currentUser;
          if (!current || current.id !== authUser.id) return;
          setUser({
            ...current,
            organisation_id: data?.organisation_id ?? current.organisation_id,
            role: error ? null : (data?.role ?? null),
          });
        });
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session);
      setLoading(false);
      clearTimeout(timeout);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  if (loading) return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
      <div className="text-yellow-500 text-sm font-mono animate-pulse">Loading...</div>
    </div>
  );

  return (
    <ThemeProvider>
      <BrowserRouter>
        <PatrolSessionProvider>
          <AppLayout currentUser={currentUser} />
          <Toaster />
        </PatrolSessionProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
};

export default App;

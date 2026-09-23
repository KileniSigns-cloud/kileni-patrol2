import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import Screen from './layout/Screen';
import EmptyState from './ui/EmptyState';
import { isAdmin } from '../lib/roles';

/**
 * Sends signed-out users to /login. With adminOnly, waits for the role to load from
 * public.users and shows an "Admins only" screen to everyone else. This is a UX guard:
 * the database's RLS policies are what actually stop non-admin writes.
 */
const ProtectedRoute: React.FC<{ adminOnly?: boolean; children: React.ReactNode }> = ({ adminOnly = false, children }) => {
  const currentUser = usePatrolStore((s) => s.currentUser);
  const navigate = useNavigate();

  if (!currentUser) return <Navigate to="/login" replace />;
  if (!adminOnly) return <>{children}</>;

  if (currentUser.role === undefined) {
    return (
      <Screen nav>
        <p className="text-mut mt-6 flex items-center gap-2" role="status"><span className="spin" aria-hidden />Checking access…</p>
      </Screen>
    );
  }

  if (!isAdmin(currentUser.role)) {
    return (
      <Screen nav>
        <div className="mt-6">
          <EmptyState
            icon={ShieldAlert}
            tone="alert"
            title="Admins only"
            body="Route management is limited to admin accounts. Ask an admin if a route needs changing."
            action={{ label: 'Back to routes', onClick: () => navigate('/routes', { replace: true }) }}
          />
        </div>
      </Screen>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;

import { Navigate, useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';

export const isAdmin = (role: string | null | undefined) => role === 'admin';

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
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center" role="status">
        <span className="text-[#8F8F8F] text-sm animate-pulse motion-reduce:animate-none">Checking access…</span>
      </div>
    );
  }

  if (!isAdmin(currentUser.role)) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center gap-4 px-8 text-center">
        <ShieldAlert className="w-12 h-12 text-[#8F8F8F]" aria-hidden />
        <h1 className="text-xl font-black text-white">Admins only</h1>
        <p className="text-sm text-[#8F8F8F]">Route management is available to administrators.</p>
        <button
          onClick={() => navigate('/routes', { replace: true })}
          className="min-h-12 px-6 rounded-xl bg-[#FCCA3B] text-black font-black active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FCCA3B]"
        >
          Back to routes
        </button>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;

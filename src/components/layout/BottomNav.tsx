import { useNavigate, useLocation } from 'react-router-dom';
import { Clock3, Footprints, Map as MapIcon, SlidersHorizontal } from 'lucide-react';
import { usePatrolStore } from '../../store/patrol.store';
import { usePatrolSession } from '../../context/PatrolSessionContext';
import { isAdmin } from '../../lib/roles';

const TABS = [
  { path: '/routes', match: ['/routes', '/route/'], Icon: MapIcon, label: 'Routes' },
  { path: '/patrol', match: ['/patrol'], Icon: Footprints, label: 'Patrol' },
  { path: '/history', match: ['/history'], Icon: Clock3, label: 'History' },
  { path: '/admin/routes', match: ['/admin'], Icon: SlidersHorizontal, label: 'Admin', adminOnly: true },
];

/** Routes / Patrol / History / Admin (admins only). A dot on Patrol while a session is live. */
const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const role = usePatrolStore((s) => s.currentUser?.role);
  const { sessionId } = usePatrolSession();

  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 inset-x-0 z-[5] bg-sf border-t border-line"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="max-w-app mx-auto flex">
        {TABS.filter((t) => !t.adminOnly || isAdmin(role)).map(({ path, match, Icon, label }) => {
          const current = match.some((m) => pathname.startsWith(m));
          const live = path === '/patrol' && sessionId !== null;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              aria-current={current ? 'page' : undefined}
              className={`relative flex-1 min-h-[66px] flex flex-col items-center justify-center gap-0.5 text-xs font-bold border-0 bg-transparent cursor-pointer ${
                current ? 'text-prix' : 'text-mut'
              }`}
            >
              <Icon className="w-6 h-6" aria-hidden />
              {label}
              {live && (
                <span className="absolute top-3 left-[calc(50%+8px)] w-[9px] h-[9px] rounded-full bg-acc">
                  <span className="sr-only">(patrol running)</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;

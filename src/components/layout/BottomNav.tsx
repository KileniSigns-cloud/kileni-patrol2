import { useNavigate, useLocation } from 'react-router-dom';
import { Map, Zap, BarChart3, User } from 'lucide-react';

const TABS = [
  { path: '/routes',      Icon: Map,       label: 'ROUTES'  },
  { path: '/quick-catch', Icon: Zap,        label: 'CATCH'   },
  { path: '/admin',       Icon: BarChart3,  label: 'ADMIN'   },
  { path: '/profile',     Icon: User,       label: 'PROFILE' },
];

const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-[#0A0A0A] border-t border-[#2A2A2A] z-50 flex">
      {TABS.map(({ path, Icon, label }) => {
        const active = isActive(path);
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5"
          >
            <Icon className={`w-5 h-5 transition-colors ${active ? 'text-[#FCCA3B]' : 'text-[#8F8F8F]'}`} />
            <span className={`text-[10px] font-bold tracking-widest transition-colors ${active ? 'text-[#FCCA3B]' : 'text-[#8F8F8F]'}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;

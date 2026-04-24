import { useNavigate, useLocation } from 'react-router-dom';

const TABS = [
  { path: '/routes', icon: '🗺', label: 'ROUTES' },
  { path: '/quick-catch', icon: '⚡', label: 'CATCH' },
  { path: '/admin', icon: '📊', label: 'ADMIN' },
  { path: '/profile', icon: '👤', label: 'PROFILE' },
];

const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-[#0A0A0A] border-t border-[#2A2A2A] z-50 flex">
      {TABS.map(tab => (
        <button
          key={tab.path}
          onClick={() => navigate(tab.path)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5"
        >
          <span className="text-lg leading-none">{tab.icon}</span>
          <span className={`text-[10px] font-bold tracking-widest transition-colors ${
            isActive(tab.path) ? 'text-[#FCCA3B]' : 'text-[#8F8F8F]'
          }`}>
            {tab.label}
          </span>
        </button>
      ))}
    </nav>
  );
};

export default BottomNav;

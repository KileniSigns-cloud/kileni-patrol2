import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

interface AdminHeaderProps {
  title: string;
  sub?: string;
  /** Back link target and label; omitted on top-level screens. */
  back?: { to: string; label: string };
  badge?: string;
  action?: React.ReactNode;
}

/** Back link, optional code badge, title with optional action, and a one-line subtitle. */
const AdminHeader: React.FC<AdminHeaderProps> = ({ title, sub, back, badge, action }) => {
  const navigate = useNavigate();
  return (
    <div>
      {back && (
        <button className="linkb -ml-1" onClick={() => navigate(back.to)}>
          <ChevronLeft aria-hidden />{back.label}
        </button>
      )}
      {badge && <div><span className="badge">{badge}</span></div>}
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 break-words">{title}</h1>
        {action}
      </div>
      {sub && <p className="sub">{sub}</p>}
    </div>
  );
};

export default AdminHeader;

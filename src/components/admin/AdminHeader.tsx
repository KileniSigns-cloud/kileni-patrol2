import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface AdminHeaderProps {
  eyebrow: string;
  title: string;
  backTo: string;
  action?: React.ReactNode;
}

const AdminHeader: React.FC<AdminHeaderProps> = ({ eyebrow, title, backTo, action }) => {
  const navigate = useNavigate();
  return (
    <header className="px-4 sm:px-6 pt-10 pb-5">
      <button
        onClick={() => navigate(backTo)}
        className="-ml-3 mb-3 min-h-12 px-3 inline-flex items-center gap-2 rounded-xl text-sm font-semibold text-[#8F8F8F] hover:text-white transition-colors active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FCCA3B]"
      >
        <ArrowLeft className="w-5 h-5" aria-hidden />
        Back
      </button>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#8F8F8F]">{eyebrow}</p>
          <h1 className="text-3xl font-black text-white mt-1 truncate">{title}</h1>
        </div>
        {action}
      </div>
    </header>
  );
};

export default AdminHeader;

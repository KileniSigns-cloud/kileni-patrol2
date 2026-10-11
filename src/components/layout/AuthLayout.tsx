import { ScanEye } from 'lucide-react';

/** Signed-out screens (sign in, forgot / reset password): brand panel on wide screens, logo on phones. */
const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-bg text-tx flex">
    {/* Brand panel — wide screens only */}
    <div className="hidden md:flex w-1/2 bg-pri text-prit flex-col justify-between p-12">
      <span className="text-xs font-bold tracking-[0.4em] opacity-80">KILENI SIGNS</span>
      <h1 className="font-extrabold leading-none m-0" style={{ fontSize: 'clamp(80px, 12vw, 140px)' }}>PATROL</h1>
      <p className="text-xl opacity-80 m-0">Eyes on every sign.</p>
    </div>

    <div className="w-full md:w-1/2 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 font-extrabold text-[19px] mb-8 md:hidden">
          <span className="w-[34px] h-[34px] rounded-[10px] bg-pri text-prit grid place-items-center">
            <ScanEye className="w-5 h-5" aria-hidden />
          </span>
          Patrol
        </div>
        {children}
      </div>
    </div>
  </div>
);

export default AuthLayout;

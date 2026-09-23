import { useLocation, useNavigate } from 'react-router-dom';
import { CircleUserRound, Moon, ScanEye, Sun } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { usePatrolSession } from '../../context/PatrolSessionContext';
import { formatClock } from '../../lib/patrolHistory';

// Flow screens: tapping the live bar there would abandon the sign in progress.
const FLOW_PREFIXES = ['/add-business/', '/photos/', '/patrol-type/', '/sign-type/', '/sign-condition/', '/issues/', '/success/'];

const iconBtn =
  'w-12 h-12 rounded-xl border border-line bg-sf grid place-items-center text-tx cursor-pointer [&_svg]:w-5 [&_svg]:h-5';

/** Sticky brand header with theme + profile buttons and, while a patrol runs, the live timer bar. */
const AppHeader: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isDark, toggle } = useTheme();
  const { sessionId, routeCode, routeName, elapsedSeconds } = usePatrolSession();
  const inFlow = FLOW_PREFIXES.some((p) => pathname.startsWith(p));

  return (
    <header
      className="sticky top-0 z-10 px-4 pb-2.5 backdrop-blur-md"
      style={{ paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))', background: 'color-mix(in srgb, var(--bg) 90%, transparent)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-extrabold text-[19px] tracking-[-0.2px]">
          <span className="w-[34px] h-[34px] rounded-[10px] bg-pri text-prit grid place-items-center">
            <ScanEye className="w-5 h-5" aria-hidden />
          </span>
          Patrol
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggle} className={iconBtn} aria-label={`Switch to ${isDark ? 'day' : 'night'} mode`}>
            {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          </button>
          <button onClick={() => navigate('/profile')} className={iconBtn} aria-label="Profile and sign out">
            <CircleUserRound aria-hidden />
          </button>
        </div>
      </div>

      {sessionId && (
        <button
          onClick={() => { if (!inFlow) navigate(`/patrol/${sessionId}`); }}
          aria-label={`Patrolling ${routeCode ?? routeName ?? 'route'}, ${formatClock(elapsedSeconds)} elapsed${inFlow ? '' : '. Open patrol'}`}
          className="mt-2.5 w-full flex items-center gap-2.5 rounded-[14px] bg-pri text-prit px-4 min-h-[50px] font-bold border-0 cursor-pointer"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-current flex-none animate-[patrol-pulse_1.6s_infinite]" aria-hidden />
          <span className="truncate">Patrolling {routeCode ?? routeName ?? ''}</span>
          <b className="ml-auto tabular-nums text-[19px] tracking-[0.3px]">{formatClock(elapsedSeconds)}</b>
        </button>
      )}
    </header>
  );
};

export default AppHeader;

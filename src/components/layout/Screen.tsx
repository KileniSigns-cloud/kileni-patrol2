import AppHeader from './AppHeader';
import BottomNav from './BottomNav';

interface ScreenProps {
  children: React.ReactNode;
  /** Show the bottom tab bar (list screens). Flow screens use `footer` instead. */
  nav?: boolean;
  /** Fixed footer action bar (see FlowFooter). */
  footer?: React.ReactNode;
}

/** Page shell: header (with live timer), centred 560px content column, footer or tab bar. */
const Screen: React.FC<ScreenProps> = ({ children, nav = false, footer }) => (
  <div className="min-h-screen bg-bg text-tx">
    <div className="max-w-app mx-auto">
      <AppHeader />
      <main className={`px-4 pt-1.5 ${footer ? 'pb-44' : nav ? 'pb-28' : 'pb-12'}`}>{children}</main>
    </div>
    {footer}
    {nav && !footer && <BottomNav />}
  </div>
);

export default Screen;

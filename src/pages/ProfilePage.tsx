import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Moon, Sun } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import Screen from '../components/layout/Screen';

const roleLabel = (role: string | null | undefined) =>
  role === undefined ? 'Loading…' : role ? role[0].toUpperCase() + role.slice(1) : 'No role';

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, setUser } = usePatrolStore();
  const { isDark, toggle } = useTheme();

  if (!currentUser) return null;

  const initials = currentUser.email
    .split('@')[0]
    .slice(0, 2)
    .toUpperCase();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    navigate('/login');
  };

  return (
    <Screen nav>
      <h1>Profile</h1>
      <p className="sub">Your account on this device.</p>

      <div className="card flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-pri text-prit grid place-items-center flex-none">
          <span className="font-extrabold text-xl">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold truncate m-0">{currentUser.email}</p>
          <span className="badge mt-1.5">{roleLabel(currentUser.role)}</span>
        </div>
      </div>

      <h2 className="section-title">Appearance</h2>
      <button className="rowcard" onClick={toggle} aria-pressed={isDark}>
        <span className="icon-tile">{isDark ? <Moon aria-hidden /> : <Sun aria-hidden />}</span>
        <span className="flex-1 flex flex-col">
          <span className="row-name">{isDark ? 'Night mode' : 'Day mode'}</span>
          <span className="row-meta">Tap to switch to {isDark ? 'day' : 'night'} mode</span>
        </span>
      </button>

      <button className="btn btn-dt btn-lg btn-full mt-6" onClick={handleSignOut}>
        <LogOut aria-hidden />Sign out
      </button>
    </Screen>
  );
};

export default ProfilePage;

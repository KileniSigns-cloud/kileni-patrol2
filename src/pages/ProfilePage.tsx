import React from 'react';
import { useNavigate } from 'react-router-dom';
import { usePatrolStore } from '../store/patrol.store';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import BottomNav from '../components/layout/BottomNav';

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
    <div className="bg-[#0A0A0A] min-h-screen pb-20">
      {/* Header */}
      <div className="px-5 pt-14 pb-6">
        <p className="text-xs tracking-widest text-[#FCCA3B] uppercase mb-1">Account</p>
        <h1 className="text-3xl font-black text-white">Profile</h1>
      </div>

      {/* Identity card */}
      <div className="mx-5 bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-5">
        <div className="flex items-center gap-4">
          {/* Initials circle */}
          <div className="w-16 h-16 rounded-full bg-[#FCCA3B] flex items-center justify-center flex-shrink-0">
            <span className="text-black font-black text-xl">{initials}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white font-semibold text-sm truncate">{currentUser.email}</p>
            <span className="inline-block mt-1.5 bg-[#FCCA3B] text-black text-[10px] font-black tracking-widest px-2.5 py-0.5 rounded-full uppercase">
              Admin
            </span>
          </div>
        </div>
      </div>

      {/* Appearance */}
      <div className="mx-5 mt-4 bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-5">
        <p className="text-[#8F8F8F] text-xs tracking-widest uppercase mb-4">Appearance</p>
        <button
          onClick={toggle}
          className="flex items-center justify-between w-full"
        >
          <span className="text-white font-semibold text-sm">
            {isDark ? 'Dark Mode' : 'Light Mode'}
          </span>
          {/* Animated pill toggle */}
          <div className={`relative w-12 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${isDark ? 'bg-[#FCCA3B]' : 'bg-[#2A2A2A]'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${isDark ? 'translate-x-6' : 'translate-x-0'}`} />
          </div>
        </button>
      </div>

      {/* Sign out */}
      <div className="mx-5 mt-4">
        <button
          onClick={handleSignOut}
          className="w-full py-4 bg-red-500/10 border border-red-500/30 text-red-400 font-black text-base rounded-2xl hover:bg-red-500/20 transition-colors active:scale-[0.98]"
        >
          Sign Out
        </button>
      </div>

      <BottomNav />
    </div>
  );
};

export default ProfilePage;

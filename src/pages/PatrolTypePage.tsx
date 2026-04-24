import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cls, C } from '../lib/ui';
import { usePatrolSession } from '../context/PatrolSessionContext';
import TimerBar from '../components/layout/TimerBar';

const PATROL_OPTIONS = [
  {
    type: 'day' as const,
    icon: '☀️',
    title: 'Day Patrol',
    subtitle: 'Visible daylight inspection',
  },
  {
    type: 'night' as const,
    icon: '🌙',
    title: 'Night Patrol',
    subtitle: 'Illumination & visibility check',
  },
];

const PatrolTypePage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessionId: activeSessionId, patrolType, setPatrolType } = usePatrolSession();

  const [selected, setSelected] = useState<'day' | 'night' | null>(patrolType);

  if (!activeSessionId) {
    return (
      <div className={`${cls.page} items-center justify-center gap-4 px-6`}>
        <p className={cls.muted}>No active patrol session.</p>
        <button onClick={() => navigate('/routes')} className="text-yellow-500 text-sm underline">
          Back to Routes
        </button>
      </div>
    );
  }

  const handleSelect = (type: 'day' | 'night') => {
    setSelected(type);
    setPatrolType(type);
  };

  return (
    <div className={cls.page}>
      <TimerBar showBack={false} showCancel={false} />

      {/* Top bar */}
      <div className="pt-16 px-5 flex justify-between items-center">
        <button
          onClick={() => navigate(`/photos/${sessionId}`)}
          className="text-[#8F8F8F] text-sm"
        >
          ← Back
        </button>
        <span className="text-xs font-semibold text-[#8F8F8F]">6 OF 9</span>
      </div>

      {/* Page header */}
      <div className="px-5 mt-6 pb-6">
        <p className="text-xs tracking-widest text-[#FCCA3B] uppercase">PATROL CONDITIONS</p>
        <h1 className="font-black text-3xl text-white mt-1">Patrol Type</h1>
      </div>

      {/* Selection cards */}
      <div className="flex-1 px-5 flex flex-col gap-4">
        {PATROL_OPTIONS.map(({ type, icon, title, subtitle }) => {
          const isSelected = selected === type;
          return (
            <button
              key={type}
              onClick={() => handleSelect(type)}
              className={[
                'w-full text-left relative rounded-2xl p-6 bg-[#1C1C1E] overflow-hidden transition-all active:scale-[0.98]',
                isSelected
                  ? 'border border-[#2A2A2A] border-l-4 border-l-[#FCCA3B]'
                  : 'border border-[#2A2A2A] opacity-70',
              ].join(' ')}
            >
              {isSelected && (
                <span className="absolute top-4 right-4 text-[#FCCA3B] font-bold text-lg leading-none">✓</span>
              )}
              <span className="text-5xl mb-3 block">{icon}</span>
              <p className="font-black text-white text-xl">{title}</p>
              <p className="text-[#8F8F8F] text-sm mt-1">{subtitle}</p>
            </button>
          );
        })}
      </div>

      {/* Bottom action */}
      <div className={cls.bottomBar}>
        <button
          onClick={() => navigate(`/sign-type/${sessionId}`)}
          disabled={!selected}
          className={cls.btnPrimary}
        >
          Continue →
        </button>
      </div>
    </div>
  );
};

export default PatrolTypePage;

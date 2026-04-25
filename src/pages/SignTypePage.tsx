import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cls, C } from '../lib/ui';
import { usePatrolSession } from '../context/PatrolSessionContext';
import TimerBar from '../components/layout/TimerBar';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type Category = 'Illuminated' | 'Non-Illuminated';

const SIGN_TYPES: Record<Category, string[]> = {
  'Illuminated': [
    'Channel Letters',
    'LED Cabinet / Sign Box',
    'Monument Signs',
    'Digital & Electronic Displays',
    'Specialty Illuminated',
    'Other',
  ],
  'Non-Illuminated': [
    'Flat Cut Letters',
    'ACP Panel Signs',
    'Pylon / Pole Signs',
    'Wayfinding / Directional',
    'Window Graphics',
    'Other',
  ],
};

const CATEGORIES: Category[] = ['Illuminated', 'Non-Illuminated'];

const SignTypePage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessionId: activeSessionId, signCategory: ctxSignCategory, signType: ctxSignType, setSignCategory, setSignType } = usePatrolSession();

  const [category, setCategory] = useState<Category | null>(ctxSignCategory as Category | null);
  const [signType, setSignTypeState] = useState<string | null>(ctxSignType);

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

  const handleCategorySelect = (cat: Category) => {
    setCategory(cat);
    setSignTypeState(null);
    setSignCategory(cat);
  };

  const handleTypeSelect = (type: string) => {
    setSignTypeState(type);
    setSignCategory(category!);
    setSignType(type);
  };

  return (
    <div className={cls.page}>
      <TimerBar showBack={false} showCancel={false} />

      {/* Top bar */}
      <div className="pt-16 px-5 flex justify-between items-center">
        <button
          onClick={() => navigate(`/patrol-type/${sessionId}`)}
          className="flex items-center gap-1 text-[#8F8F8F] text-sm"
        >
          <ChevronLeft className="w-5 h-5" /> Back
        </button>
        <span className="text-xs font-semibold text-[#8F8F8F]">7 OF 9</span>
      </div>

      {/* Page header */}
      <div className="px-5 mt-6 pb-5">
        <p className="text-xs tracking-widest text-[#FCCA3B] uppercase">SIGN IDENTIFICATION</p>
        <h1 className="font-black text-3xl text-white mt-1">Sign Type</h1>
      </div>

      <div className="flex-1 px-5 overflow-y-auto pb-32">

        {/* Category toggle pills */}
        <div className="flex rounded-2xl overflow-hidden">
          {CATEGORIES.map(cat => {
            const isSelected = category === cat;
            return (
              <button
                key={cat}
                onClick={() => handleCategorySelect(cat)}
                className={[
                  'flex-1 py-3 text-sm font-bold transition-colors',
                  isSelected
                    ? 'bg-[#FCCA3B] text-black'
                    : 'bg-[#1C1C1E] text-[#8F8F8F]',
                ].join(' ')}
              >
                {cat === 'Illuminated' ? 'ILLUMINATED' : 'NON-ILLUMINATED'}
              </button>
            );
          })}
        </div>

        {/* Sign type grid */}
        {category && (
          <div className="grid grid-cols-2 gap-3 mt-4">
            {SIGN_TYPES[category].map(type => {
              const isSelected = signType === type;
              return (
                <button
                  key={type}
                  onClick={() => handleTypeSelect(type)}
                  className={[
                    'bg-[#1C1C1E] rounded-2xl p-4 text-center transition-all active:scale-[0.97]',
                    isSelected
                      ? 'border border-[#FCCA3B] text-white'
                      : 'border border-[#2A2A2A] text-[#8F8F8F]',
                  ].join(' ')}
                >
                  <span className="font-semibold text-sm leading-snug">{type}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom action */}
      <div className={cls.bottomBar}>
        <button
          onClick={() => navigate(`/issues/${sessionId}`)}
          disabled={!category || !signType}
          className={cls.btnPrimary}
        >
          <span className="flex items-center justify-center gap-1.5">Continue <ChevronRight className="w-5 h-5" /></span>
        </button>
      </div>
    </div>
  );
};

export default SignTypePage;

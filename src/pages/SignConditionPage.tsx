import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cls } from '../lib/ui';
import { usePatrolSession } from '../context/PatrolSessionContext';
import TimerBar from '../components/layout/TimerBar';
import { ChevronLeft } from 'lucide-react';

const SignConditionPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessionId: activeSessionId } = usePatrolSession();

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

  return (
    <div className={cls.page}>
      <TimerBar showBack={false} showCancel={false} />
      <div className="px-4 pt-14 pb-2 flex items-center justify-between">
        <button
          onClick={() => navigate(`/sign-type/${sessionId}`)}
          className="flex items-center gap-1 text-[#8F8F8F] text-sm"
        >
          <ChevronLeft className="w-5 h-5" /> Back
        </button>
        <span className="text-xs text-gray-600 font-mono">8 of 9</span>
      </div>
      <div className="px-4 pt-2">
        <p className={`${cls.accent} mb-1`}>Sign Assessment</p>
        <h1 className="text-2xl font-black text-white">Sign Condition</h1>
        <p className={`${cls.muted} mt-1`}>Rate the condition of the sign</p>
      </div>
    </div>
  );
};

export default SignConditionPage;

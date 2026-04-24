import React from 'react';
import { usePatrolSession } from '../../context/PatrolSessionContext';

interface TimerBarProps {
  onCancel?: () => void;
  onBack?: () => void;
  showCancel?: boolean;
  showBack?: boolean;
}

const TimerBar: React.FC<TimerBarProps> = ({
  onCancel,
  onBack,
  showCancel = true,
  showBack = false,
}) => {
  const { elapsedSeconds } = usePatrolSession();
  const seconds = elapsedSeconds;
  const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
  const secs = String(seconds % 60).padStart(2, '0');

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-12 bg-gray-900 text-white px-4 flex items-center justify-between shadow-lg">
      {showBack ? (
        <button
          onClick={onBack}
          className="font-bold text-lg text-white hover:text-gray-300 transition-colors"
        >
          ‹
        </button>
      ) : (
        <div className="w-8" />
      )}
      <div className="text-xl font-mono font-bold tracking-widest text-yellow-400">
        {mins}:{secs}
      </div>
      {showCancel ? (
        <button
          onClick={onCancel}
          className="border border-yellow-500 text-yellow-500 rounded-full px-4 py-1 text-xs font-semibold hover:bg-yellow-500 hover:text-black transition-colors"
        >
          END
        </button>
      ) : (
        <div className="w-16" />
      )}
    </div>
  );
};

export default TimerBar;

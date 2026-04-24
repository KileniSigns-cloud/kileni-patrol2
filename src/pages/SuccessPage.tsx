import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cls } from '../lib/ui';
import { usePatrolSession } from '../context/PatrolSessionContext';
import TimerBar from '../components/layout/TimerBar';

const SuccessPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const ctx = usePatrolSession();
  const { resetForNextSign } = ctx;

  const businessName = ctx.businessName  || 'Untagged Location';
  const signCategory = ctx.signCategory  || '—';
  const signType     = ctx.signType      || '—';
  const issues       = ctx.currentIssues || [];
  const issuesLabel  = issues.length > 0 ? issues.join(', ') : 'None found';

  const summaryRows = [
    { label: 'Business', value: businessName },
    { label: 'Category', value: signCategory },
    { label: 'Type',     value: signType     },
    { label: 'Issues',   value: issuesLabel  },
  ];

  const handleLogAnother = () => {
    resetForNextSign();
    navigate(`/photos/${sessionId}`);
  };

  return (
    <div className={cls.page}>
      <TimerBar showBack={false} showCancel={false} />

      <div className="flex-1 flex flex-col items-center justify-center min-h-screen px-6">
        {/* Checkmark circle */}
        <div className="w-20 h-20 rounded-full border-2 border-[#FCCA3B] flex items-center justify-center mx-auto mt-16">
          <span className="text-[#FCCA3B] text-4xl font-black leading-none">✓</span>
        </div>

        {/* Heading */}
        <h1 className="text-3xl font-black text-white text-center mt-5">Inspection Logged</h1>

        {/* CRM status */}
        <p className="text-[#8F8F8F] text-sm text-center mt-2">
          <span className="inline-block w-2 h-2 bg-emerald-400 rounded-full mr-2 align-middle" />
          Added to BUILT CRM
        </p>

        {/* Summary card */}
        <div className="bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-5 mt-8 w-full max-w-sm">
          {summaryRows.map((row, idx) => (
            <div
              key={row.label}
              className={[
                'flex justify-between items-center py-3',
                idx < summaryRows.length - 1 ? 'border-b border-[#2A2A2A]' : '',
              ].join(' ')}
            >
              <span className="text-[#8F8F8F] text-xs tracking-widest uppercase">{row.label}</span>
              <span className="text-white font-semibold text-sm text-right max-w-[60%] truncate">{row.value}</span>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="mt-8 w-full max-w-sm space-y-3">
          <button onClick={handleLogAnother} className={cls.btnPrimary}>
            📸 Log Another Sign
          </button>
          <button
            onClick={() => navigate(`/patrol/${sessionId}`)}
            className={`${cls.btnGhost} w-full py-4 rounded-2xl text-base font-semibold`}
          >
            ✓ Done for Now
          </button>
        </div>

        {/* Bottom note */}
        <p className="text-[#8F8F8F] text-xs text-center mt-6">
          Timer is still running. End patrol from the patrol screen.
        </p>
      </div>
    </div>
  );
};

export default SuccessPage;

import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, Check } from 'lucide-react';
import { usePatrolSession } from '../context/PatrolSessionContext';
import Screen from '../components/layout/Screen';
import FlowFooter from '../components/flow/FlowFooter';
import NoSession from '../components/flow/NoSession';

const PATROL_TYPE_LABEL: Record<string, string> = { day: 'Day', night: 'Night' };

const SuccessPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const ctx = usePatrolSession();
  const { resetForNextSign } = ctx;

  if (!ctx.sessionId) return <NoSession />;

  const issues = ctx.currentIssues || [];
  const photos = (ctx.signPhotoUrls?.length ?? 0) + (ctx.surroundingPhotoUrls?.length ?? 0);

  const summaryRows: [string, string][] = [
    ['Business', ctx.businessName || 'Unnamed business'],
    ['Sign', [ctx.signCategory, ctx.signType].filter(Boolean).join(', ') || '—'],
    ['Patrol type', ctx.patrolType ? PATROL_TYPE_LABEL[ctx.patrolType] : '—'],
    ['Photos', String(photos)],
    ['Issues', issues.length > 0 ? issues.join(', ') : 'None'],
  ];

  const handleLogAnother = () => {
    resetForNextSign();
    navigate(`/photos/${sessionId}`);
  };

  return (
    <Screen
      footer={
        <FlowFooter>
          <button className="btn btn-pri btn-xl btn-full" onClick={handleLogAnother}>
            <Camera aria-hidden />Log another sign here
          </button>
          <button className="btn btn-lg btn-full" onClick={() => navigate(`/patrol/${sessionId}`)}>Done</button>
        </FlowFooter>
      }
    >
      <div className="text-center pt-5">
        <div className="w-[88px] h-[88px] rounded-full bg-oks text-ok grid place-items-center mx-auto mb-3">
          <Check className="w-12 h-12" aria-hidden />
        </div>
        <h1>Sign logged</h1>
        <p className="sub">Saved to this patrol. The timer is still running.</p>
      </div>

      <div className="card">
        {summaryRows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 py-2.5 border-b border-line last:border-b-0">
            <span className="text-mut font-semibold">{label}</span>
            <b className="text-right break-words min-w-0">{value}</b>
          </div>
        ))}
      </div>
    </Screen>
  );
};

export default SuccessPage;

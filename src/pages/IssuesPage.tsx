import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cls, C } from '../lib/ui';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { usePatrolStore } from '../store/patrol.store';
import { supabase } from '../lib/supabase';
import TimerBar from '../components/layout/TimerBar';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const ORG_ID = '8239bb55-2423-43c1-bb54-6370765f2275';

const ISSUES = [
  'Damaged / Impact damage',
  'Loose / Structurally unsafe',
  'Falling / Leaning',
  'Partially lit',
  'Fully dark / Not illuminated',
  'Peeling graphics',
  'Faded / Sun bleached',
  'Missing letters or elements',
  'Other',
];

function getSeverity(count: number): string {
  if (count === 0) return 'excellent';
  if (count <= 2) return 'good';
  if (count <= 4) return 'fair';
  if (count <= 6) return 'poor';
  return 'critical';
}

function getSeverityDisplay(count: number): { label: string; pill: string } {
  const rating = getSeverity(count);
  if (rating === 'excellent' || rating === 'good')
    return { label: rating.toUpperCase(), pill: 'bg-[#30D158]/20 text-[#30D158]' };
  if (rating === 'fair')
    return { label: 'FAIR', pill: 'bg-yellow-500/20 text-yellow-400' };
  return { label: rating.toUpperCase(), pill: 'bg-red-500/20 text-red-400' };
}

const IssuesPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const {
    sessionId: ctxSessionId, businessId, businessName: ctxBusinessName,
    patrolType, signCategory, signType,
    signPhotoUrls, surroundingPhotoUrls,
    currentIssues, currentNotes,
    setIssues, setNotes, setInspectionId,
  } = usePatrolSession();
  const { currentUser } = usePatrolStore();

  const [selected, setSelected] = useState<string[]>(currentIssues);
  const [notes, setNotesState] = useState<string>(currentNotes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ctxSessionId) {
    return (
      <div className={`${cls.page} items-center justify-center gap-4 px-6`}>
        <p className={cls.muted}>No active patrol session.</p>
        <button onClick={() => navigate('/routes')} className="text-yellow-500 text-sm underline">
          Back to Routes
        </button>
      </div>
    );
  }

  const toggle = (issue: string) => {
    const next = selected.includes(issue)
      ? selected.filter(i => i !== issue)
      : [...selected, issue];
    setSelected(next);
    setIssues(next);
  };

  const handleNotes = (val: string) => {
    setNotesState(val);
    setNotes(val);
  };

  const severity = getSeverityDisplay(selected.length);

  const handleSubmit = async () => {
    if (!businessId || !currentUser) return;
    setLoading(true);
    setError(null);

    const selectedIssues = selected;
    const user = currentUser;
    const businessName = ctxBusinessName;

    try {
      // STEP A: INSERT sign_inspections
      const { data: inspData, error: inspError } = await supabase
        .from('sign_inspections')
        .insert({
          business_id: businessId,
          organisation_id: '8239bb55-2423-43c1-bb54-6370765f2275',
          business_name: businessName || null,
          sign_category: signCategory,
          sign_type: signType,
          patrol_type: patrolType,
          condition: selectedIssues,
          condition_rating: getSeverity(selectedIssues.length),
          is_compliant: selectedIssues.length === 0,
          non_compliance_reason: selectedIssues.join(', ') || null,
          notes: notes || null,
          status: 'completed',
          inspected_by: user?.id || null,
          patroller_name: user?.email || null,
          inspected_at: new Date().toISOString(),
          date_logged: new Date().toISOString(),
        })
        .select()
        .single();

      if (inspError) {
        console.error('INSP ERROR:', inspError);
        throw new Error(inspError.message || JSON.stringify(inspError));
      }
      setInspectionId(inspData.id);
      const inspectionId = inspData.id;

      // STEP B: INSERT inspection_photos
      const photoInserts = [
        ...(signPhotoUrls || []).map(url => ({
          inspection_id: inspectionId,
          business_id: businessId,
          photo_url: url,
          photo_type: 'sign',
          created_at: new Date().toISOString(),
        })),
        ...(surroundingPhotoUrls || []).map(url => ({
          inspection_id: inspectionId,
          business_id: businessId,
          photo_url: url,
          photo_type: 'surrounding',
          created_at: new Date().toISOString(),
        })),
      ];

      const { error: photoError } = await supabase
        .from('inspection_photos')
        .insert(photoInserts);

      if (photoError) throw photoError;

      // STEP C: CRM lead — fire-and-forget, non-fatal
      try {
        await supabase.from('leads').insert({
          source: 'PATROL',
          source_id: inspectionId,
          business_name: ctxBusinessName || 'Unknown',
          address: null,
          sign_type: signType,
          sign_category: signCategory,
          issue_type: selected.join(', ') || 'None',
          notes: notes || null,
          status: 'new',
          organisation_id: ORG_ID,
          created_at: new Date().toISOString(),
        });
      } catch {
        // CRM failure is non-fatal
      }

      // STEP D: navigate to success
      navigate(`/success/${sessionId}`);
    } catch (err: any) {
      setError(err?.message || err?.details || JSON.stringify(err) || 'Failed to submit inspection.');
      setLoading(false);
    }
  };

  return (
    <div className={cls.page}>
      <TimerBar showBack={false} showCancel={false} />

      {/* Top bar */}
      <div className="pt-16 px-5 flex justify-between items-center">
        <button
          onClick={() => navigate(`/sign-type/${sessionId}`)}
          className="flex items-center gap-1 text-[#8F8F8F] text-sm"
        >
          <ChevronLeft className="w-5 h-5" /> Back
        </button>
        <span className="text-xs font-semibold text-[#8F8F8F]">8 OF 9</span>
      </div>

      {/* Page header */}
      <div className="px-5 mt-6 pb-5">
        <p className="text-xs tracking-widest text-[#FCCA3B] uppercase">SIGN CONDITION</p>
        <h1 className="font-black text-3xl text-white mt-1">Issues Found</h1>
      </div>

      <div className="flex-1 px-5 overflow-y-auto pb-32 space-y-4">

        {/* Issues checklist */}
        <div className="bg-[#1C1C1E] rounded-2xl overflow-hidden">
          {ISSUES.map((issue, idx) => {
            const isChecked = selected.includes(issue);
            return (
              <button
                key={issue}
                onClick={() => toggle(issue)}
                className={[
                  'w-full flex items-center justify-between px-5 py-4 transition-colors active:bg-[#2A2A2A]',
                  idx < ISSUES.length - 1 ? 'border-b border-[#2A2A2A]' : '',
                ].join(' ')}
              >
                <span className="text-white text-sm font-medium text-left">{issue}</span>
                <div className={[
                  'w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ml-3 transition-colors',
                  isChecked ? 'bg-[#FCCA3B]' : 'border border-[#2A2A2A]',
                ].join(' ')}>
                  {isChecked && <span className="text-black text-xs font-black leading-none">✓</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Severity badge */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8F8F8F]">Condition:</span>
          <span className={`rounded-full px-4 py-1 text-xs font-bold transition-colors ${severity.pill}`}>
            {severity.label}
          </span>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-bold tracking-widest text-[#8F8F8F] mb-2">
            NOTES <span className="normal-case tracking-normal font-normal text-[#8F8F8F]">— optional</span>
          </label>
          <textarea
            value={notes}
            onChange={e => handleNotes(e.target.value)}
            placeholder="Describe the issue in more detail…"
            className="bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl px-4 py-3 w-full text-white placeholder-[#8F8F8F] focus:border-[#FCCA3B] focus:outline-none text-sm h-28 resize-none"
          />
        </div>
      </div>

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-24 left-4 right-4 z-50 bg-[#FF3B30] text-white rounded-2xl p-4 text-sm font-semibold">
          {error}
        </div>
      )}

      {/* Bottom action */}
      <div className={cls.bottomBar}>
        {/* Severity badge */}
        {(() => {
          const n = selected.length;
          const [pill, label] =
            n === 0 ? ['bg-emerald-500/10 text-emerald-400 border border-emerald-500/20', '● GOOD CONDITION']
            : n <= 2 ? ['bg-yellow-500/10 text-yellow-400 border border-yellow-500/20', '● NEEDS ATTENTION']
            :          ['bg-red-500/10 text-red-400 border border-red-500/20', '● CRITICAL'];
          return (
            <div className={`rounded-full px-4 py-2 text-xs font-bold text-center mx-auto w-fit mb-3 ${pill}`}>
              {label}
            </div>
          );
        })()}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className={cls.btnPrimary}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Submitting…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1.5">Submit Inspection <ChevronRight className="w-5 h-5" /></span>
          )}
        </button>
      </div>
    </div>
  );
};

export default IssuesPage;

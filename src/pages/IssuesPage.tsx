import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { usePatrolStore } from '../store/patrol.store';
import { supabase } from '../lib/supabase';
import { buildSignInspectionInsert } from '../lib/signFlow';
import { errorMessage } from '../lib/errors';
import Screen from '../components/layout/Screen';
import StepProgress from '../components/flow/StepProgress';
import FlowFooter, { FooterRow } from '../components/flow/FlowFooter';
import NoSession from '../components/flow/NoSession';

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

const IssuesPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const {
    sessionId: ctxSessionId, businessId, businessName: ctxBusinessName,
    patrolType, signCategory, signType, inspectionId,
    signPhotoUrls, surroundingPhotoUrls,
    currentIssues, currentNotes, reusingBusiness,
    setIssues, setNotes, setInspectionId, recordSignSaved,
  } = usePatrolSession();
  const { currentUser } = usePatrolStore();

  const [selected, setSelected] = useState<string[]>(currentIssues);
  const [notes, setNotesState] = useState<string>(currentNotes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ctxSessionId) return <NoSession />;

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

  const handleSubmit = async () => {
    // Never fail silently: a missing business or user is shown, not swallowed.
    const insert = buildSignInspectionInsert(
      {
        businessId, businessName: ctxBusinessName, patrolType, signCategory, signType, inspectionId,
        signPhotoUrls, surroundingPhotoUrls, currentIssues: selected, currentNotes: notes, reusingBusiness,
      },
      currentUser,
      notes,
      new Date().toISOString(),
    );
    if (!insert.ok) {
      setError(insert.error);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      // STEP A: INSERT sign_inspections
      const { data: inspData, error: inspError } = await supabase
        .from('sign_inspections')
        .insert(insert.row)
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
          id: crypto.randomUUID(),
          inspection_id: inspectionId,
          business_id: businessId,
          photo_url: url,
          photo_type: 'sign',
          created_at: new Date().toISOString(),
        })),
        ...(surroundingPhotoUrls || []).map(url => ({
          id: crypto.randomUUID(),
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
        const allPhotoUrls = [
          ...(signPhotoUrls || []),
          ...(surroundingPhotoUrls || []),
        ];
        await supabase.from('leads').insert({
          id: crypto.randomUUID(),
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
          photos: allPhotoUrls,
          created_at: new Date().toISOString(),
        });
      } catch {
        // CRM failure is non-fatal
      }

      // Session list on Active patrol: count this sign against its business.
      if (businessId) recordSignSaved(businessId, patrolType);

      // STEP D: navigate to success
      navigate(`/success/${sessionId}`);
    } catch (err) {
      setError(errorMessage(err, 'Failed to submit inspection.'));
      setLoading(false);
    }
  };

  return (
    <Screen
      footer={
        <FlowFooter>
          {error && <p className="field-err text-center m-0" role="alert">{error}</p>}
          <FooterRow>
            <button className="btn" onClick={() => navigate(`/sign-type/${sessionId}`)} disabled={loading}>Back</button>
            <button className="btn btn-pri" onClick={handleSubmit} disabled={loading}>
              {loading ? <><span className="spin" aria-hidden />Saving…</> : <><Check aria-hidden />Save sign</>}
            </button>
          </FooterRow>
        </FlowFooter>
      }
    >
      <StepProgress step={4} />
      <h1>Issues and notes</h1>
      <p className="sub">Tick anything wrong. Leave it blank if the sign looks fine.</p>

      <div className="grid gap-2.5">
        {ISSUES.map((issue) => (
          <label key={issue} className="chk">
            <input type="checkbox" checked={selected.includes(issue)} onChange={() => toggle(issue)} />
            <span className="box"><Check aria-hidden /></span>
            {issue}
          </label>
        ))}
      </div>

      <label className="field-label" htmlFor="inn">Notes <span>(optional)</span></label>
      <textarea
        id="inn"
        className="input"
        value={notes}
        onChange={(e) => handleNotes(e.target.value)}
        placeholder="What you saw and where on the sign"
      />
    </Screen>
  );
};

export default IssuesPage;

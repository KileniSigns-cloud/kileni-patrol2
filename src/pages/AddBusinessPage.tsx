import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Crosshair, LocateFixed, MapPinOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { usePatrolStore } from '../store/patrol.store';
import { useGPS } from '../hooks/useGPS';
import { errorMessage } from '../lib/errors';
import { buildBusinessWrite } from '../lib/signFlow';
import Screen from '../components/layout/Screen';
import StepProgress from '../components/flow/StepProgress';
import FlowFooter, { FooterRow } from '../components/flow/FlowFooter';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import NoSession from '../components/flow/NoSession';

const AddBusinessPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const {
    sessionId: activeSessionId, businessId, loggedBusinesses,
    setBusinessId, setBusinessName, addLoggedBusiness, updateLoggedBusiness,
  } = usePatrolSession();
  const { currentUser } = usePatrolStore();

  // Back from Photos: this flow already saved a business, so the form edits that row.
  // (Add business on Active patrol clears businessId first, so a new business starts empty.)
  const editing = businessId ? loggedBusinesses.find((b) => b.id === businessId) ?? null : null;
  const hasStoredLocation = editing !== null && editing.lat !== null && editing.lng !== null;

  // An edited business keeps its stored location unless Redo is tapped.
  const { latitude, longitude, accuracy, status: gpsStatus, errorMessage: gpsErrorMessage, retry: retryGPS } = useGPS(!hasStoredLocation);
  const [relocating, setRelocating] = useState(false);
  const useStoredLocation = hasStoredLocation && !relocating;
  const lat = useStoredLocation ? editing!.lat : gpsStatus === 'success' ? latitude : null;
  const lng = useStoredLocation ? editing!.lng : gpsStatus === 'success' ? longitude : null;
  const redoGPS = () => { setRelocating(true); retryGPS(); };

  const [businessName, setBusinessNameInput] = useState(editing?.name ?? '');
  const [address, setAddress] = useState(editing?.address ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');

  // Submit state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!activeSessionId || !sessionId) return <NoSession />;

  const handleSave = async () => {
    setError(null);
    const write = buildBusinessWrite(
      { name: businessName, address, notes, lat, lng }, editing, sessionId, currentUser, new Date().toISOString(),
    );
    if (!write.ok) { setError(write.error); return; }

    setLoading(true);
    try {
      if (write.mode === 'insert') {
        const { data, error } = await supabase.from('patrol_businesses').insert(write.row).select().single();
        if (error) throw error;
        setBusinessId(data.id);
        setBusinessName(data.name);
        addLoggedBusiness({
          id: data.id, name: data.name, address: data.address, lat, lng, notes: data.notes, signs: 0, lastPatrolType: null,
        });
      } else if (write.mode === 'update') {
        // Same row, same id: the sign's inspection id and uploaded photos are kept.
        const { data, error } = await supabase
          .from('patrol_businesses')
          .update(write.row)
          .eq('id', write.id)
          .select('id, name, address, notes')
          .maybeSingle();
        if (error) throw error;
        // RLS matched no row (rep_id isn't this user: logged by someone else, or before rep_id
        // was recorded). Never report that as saved.
        if (!data) {
          throw new Error('Changes not saved: this business was logged by another patroller or before this update, so it can\'t be edited. Undo your changes to continue.');
        }
        setBusinessName(data.name);
        updateLoggedBusiness({ id: data.id, name: data.name, address: data.address, lat, lng, notes: data.notes });
      }
      navigate('/photos/' + sessionId);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save. Try again.'));
      setLoading(false);
    }
  };

  const dirty = editing
    ? businessName !== (editing.name ?? '') || address !== (editing.address ?? '') || notes !== (editing.notes ?? '') || relocating
    : Boolean(businessName || address || notes);
  const cancel = () => (dirty ? setConfirmCancel(true) : navigate(`/patrol/${sessionId}`));
  const located = lat !== null && lng !== null;

  return (
    <Screen
      footer={
        <FlowFooter hint={error ?? (located ? null : 'No location yet. You can still continue without it.')}>
          <FooterRow>
            <button className="btn" onClick={cancel} disabled={loading}>Cancel</button>
            <button className="btn btn-pri" onClick={handleSave} disabled={loading}>
              {loading ? <><span className="spin" aria-hidden />Saving…</> : 'Next: photos'}
            </button>
          </FooterRow>
        </FlowFooter>
      }
    >
      <StepProgress step={0} />
      <h1>Business</h1>
      <p className="sub">Capture the location first. Add a name if you can read one.</p>

      {/* GPS capture card */}
      {located ? (
        <div className="flex gap-3 items-center rounded-2xl p-3.5 mb-2.5 bg-oks">
          <CheckCircle2 className="w-7 h-7 text-ok flex-none" aria-hidden />
          <div className="flex-1 min-w-0">
            <b>Location captured</b>
            <small className="block text-mut text-sm tabular-nums">
              {lat!.toFixed(5)}, {lng!.toFixed(5)}{!useStoredLocation && accuracy !== null ? `, ± ${accuracy} m` : ''}
            </small>
          </div>
          <button className="btn btn-sm" onClick={redoGPS}>Redo</button>
        </div>
      ) : gpsStatus === 'error' ? (
        <>
          <div className="flex gap-3 items-center rounded-2xl p-3.5 mb-2.5 bg-accs" role="alert">
            <MapPinOff className="w-7 h-7 text-acc flex-none" aria-hidden />
            <div className="flex-1">
              <b>Location unavailable</b>
              <small className="block text-mut text-sm">{gpsErrorMessage}</small>
            </div>
          </div>
          <button className="btn btn-pri btn-lg btn-full" onClick={retryGPS}><LocateFixed aria-hidden />Try again</button>
        </>
      ) : (
        <>
          <div className="flex gap-3 items-center rounded-2xl p-3.5 mb-2.5 bg-pris">
            <Crosshair className="w-7 h-7 text-prix flex-none" aria-hidden />
            <div className="flex-1">
              <b>{gpsStatus === 'capturing' ? 'Finding your location' : 'Location not captured'}</b>
              <small className="block text-mut text-sm">Stand near the sign, then capture.</small>
            </div>
          </div>
          <button className="btn btn-pri btn-lg btn-full" onClick={retryGPS} disabled={gpsStatus === 'capturing'}>
            {gpsStatus === 'capturing' ? <><span className="spin" aria-hidden />Finding you…</> : <><LocateFixed aria-hidden />Capture location</>}
          </button>
        </>
      )}

      <label className="field-label" htmlFor="bn">Business name <span>(optional)</span></label>
      <input id="bn" className="input" value={businessName} onChange={(e) => setBusinessNameInput(e.target.value)} placeholder="As shown on the sign" autoComplete="off" />

      <label className="field-label" htmlFor="ba">Address <span>(optional)</span></label>
      <input id="ba" className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street number and name" autoComplete="off" />

      <label className="field-label" htmlFor="bno">Notes <span>(optional)</span></label>
      <textarea id="bno" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the office should know" />

      <ConfirmDialog
        open={confirmCancel}
        danger
        title="Discard this sign?"
        message="The details you typed will be removed. Businesses already logged stay on the patrol."
        confirmLabel="Discard"
        onConfirm={() => navigate(`/patrol/${sessionId}`)}
        onCancel={() => setConfirmCancel(false)}
      />
    </Screen>
  );
};

export default AddBusinessPage;

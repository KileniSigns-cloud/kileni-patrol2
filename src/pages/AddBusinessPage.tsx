import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Crosshair, LocateFixed, MapPinOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { useGPS } from '../hooks/useGPS';
import { errorMessage } from '../lib/errors';
import Screen from '../components/layout/Screen';
import StepProgress from '../components/flow/StepProgress';
import FlowFooter, { FooterRow } from '../components/flow/FlowFooter';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import NoSession from '../components/flow/NoSession';

const AddBusinessPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessionId: activeSessionId, setBusinessId, setBusinessName, addLoggedBusiness } = usePatrolSession();

  const { latitude, longitude, accuracy, status: gpsStatus, errorMessage: gpsErrorMessage, retry: retryGPS } = useGPS();

  const [businessName, setBusinessNameInput] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Submit state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!activeSessionId) return <NoSession />;

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('patrol_businesses')
        .insert({
          session_id: sessionId,
          organisation_id: '8239bb55-2423-43c1-bb54-6370765f2275',
          name: businessName || null,
          address: address || null,
          lat: gpsStatus === 'success' ? latitude : null,
          lng: gpsStatus === 'success' ? longitude : null,
          gps_latitude: gpsStatus === 'success' ? latitude : null,
          gps_longitude: gpsStatus === 'success' ? longitude : null,
          gps_captured_at: gpsStatus === 'success' ? new Date().toISOString() : null,
          notes: notes || null,
          date_added: new Date().toISOString(),
          type: 'existing',
        })
        .select()
        .single();
      if (error) throw error;
      setBusinessId(data.id);
      setBusinessName(businessName || null);
      addLoggedBusiness({
        id: data.id,
        name: businessName || null,
        address: address || null,
        lat: gpsStatus === 'success' ? latitude : null,
        lng: gpsStatus === 'success' ? longitude : null,
        signs: 0,
        lastPatrolType: null,
      });
      navigate('/photos/' + sessionId);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save. Try again.'));
      setLoading(false);
    }
  };

  const dirty = Boolean(businessName || address || notes);
  const cancel = () => (dirty ? setConfirmCancel(true) : navigate(`/patrol/${sessionId}`));
  const located = gpsStatus === 'success' && latitude !== null && longitude !== null;

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
              {latitude!.toFixed(5)}, {longitude!.toFixed(5)}{accuracy !== null ? `, ± ${accuracy} m` : ''}
            </small>
          </div>
          <button className="btn btn-sm" onClick={retryGPS}>Redo</button>
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

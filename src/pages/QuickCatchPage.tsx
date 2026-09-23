import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGPS } from '../hooks/useGPS';
import { useCamera } from '../hooks/useCamera';
import { supabase } from '../lib/supabase';
import { buildInspectionPhotoRows, compressToBlob, uploadPhotos } from '../lib/photoStorage';
import { errorMessage } from '../lib/errors';
import { usePatrolStore } from '../store/patrol.store';
import { Camera, Check, CheckCircle2, MapPinOff, Upload, Zap } from 'lucide-react';
import Screen from '../components/layout/Screen';
import FlowFooter, { FooterRow } from '../components/flow/FlowFooter';

const SIGN_CATEGORIES = ['Illuminated', 'Non-Illuminated'] as const;
type SignCategory = typeof SIGN_CATEGORIES[number];

const SIGN_TYPES: Record<SignCategory, string[]> = {
  'Illuminated': [
    'Channel Letters', 'LED Cabinet / Sign Box', 'Monument Signs',
    'Digital & Electronic Displays', 'Specialty Illuminated', 'Other',
  ],
  'Non-Illuminated': [
    'Dimensional Letters', 'Flat Panel Signs', 'Monument Signs (Non-lit)',
    'Window & Door Graphics', 'Wall Graphics', 'Wayfinding & Directional',
    'Banners & Temporary Signs', 'Vehicle Graphics',
  ],
};

const ISSUE_TYPES = [
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

const QuickCatchPage: React.FC = () => {
  const navigate = useNavigate();
  const { latitude, longitude, status: gpsStatus, errorMessage: gpsErrorMessage, retry: retryGPS } = useGPS();
  const camera = useCamera();
  const { currentUser } = usePatrolStore();
  // Ids and upload paths of a submit whose inspection record is saved but that failed later.
  const progress = useRef<{
    leadId: string; inspectionId: string; paths: string[] | null; stubSaved: boolean; photosSaved: boolean;
  } | null>(null);

  const [businessName, setBusinessName] = useState('');
  const [address, setAddress] = useState('');
  const [signCategory, setSignCategory] = useState<SignCategory>('Illuminated');
  const [signType, setSignType] = useState('');
  const [issueType, setIssueType] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    Array.from(e.target.files).forEach(f => camera.capture(f));
    e.target.value = '';
  };

  const handleSubmit = async () => {
    setError(null);
    if (!businessName.trim()) { setError('Business name is required.'); return; }
    if (camera.files.length === 0) { setError('At least one photo is required.'); return; }
    const orgId = currentUser?.organisation_id;
    if (!orgId) { setError('You are signed out or have no organisation. Sign in again to save.'); return; }
    setSaving(true);

    // Every step is required and stops the save with its error. Once the inspection
    // record exists, a retry continues from the failed step with the same ids and
    // photos instead of creating a second record.
    const p = progress.current ?? { leadId: crypto.randomUUID(), inspectionId: crypto.randomUUID(), paths: null, stubSaved: false, photosSaved: false };
    try {
      // STEP A: upload photos to patrol-media/{org}/quick-catch/{lead_id}/ (awaited).
      if (!p.paths) {
        const photos = [];
        for (const [i, file] of camera.files.entries()) {
          photos.push({ name: `photo-${i + 1}-${crypto.randomUUID()}.jpg`, blob: await compressToBlob(file) });
        }
        p.paths = await uploadPhotos(supabase, orgId, 'quick-catch', p.leadId, photos);
      }
      const nowIso = new Date().toISOString();

      // STEP B: sign_inspections record (required).
      if (!p.stubSaved) {
        const { error: inspErr } = await supabase
          .from('sign_inspections')
          .insert({
            id: p.inspectionId,
            organisation_id: orgId,
            business_name: businessName.trim(),
            sign_category: signCategory,
            sign_type: signType || null,
            patrol_type: 'quick_catch',
            condition: issueType ? [issueType] : [],
            condition_rating: issueType ? 'fair' : 'excellent',
            is_compliant: !issueType,
            non_compliance_reason: issueType || null,
            notes: notes.trim() || null,
            status: 'completed',
            inspected_at: nowIso,
            date_logged: nowIso,
          })
          .select('id')
          .single();
        if (inspErr) throw new Error(`Quick Catch not saved: ${errorMessage(inspErr, 'inspection record failed')}`);
        p.stubSaved = true;
        progress.current = p;
      }

      // STEP C: inspection_photos with storage paths (required).
      if (!p.photosSaved) {
        const rows = buildInspectionPhotoRows(p.inspectionId, null, p.paths.map(path => ({ path, type: 'sign' as const })), nowIso);
        const { error: photoErr } = await supabase.from('inspection_photos').insert(rows);
        if (photoErr) throw new Error(`Quick Catch not saved: photos not linked (${errorMessage(photoErr, 'unknown error')})`);
        p.photosSaved = true;
      }

      // STEP D: the lead, with storage paths (no base64).
      const { error: dbErr } = await supabase.from('leads').insert({
        id: p.leadId,
        source: 'PATROL_QUICK_CATCH',
        source_id: p.inspectionId,
        business_name: businessName.trim(),
        address: address.trim() || null,
        latitude,
        longitude,
        sign_category: signCategory,
        sign_type: signType || null,
        issue_type: issueType || null,
        notes: notes.trim() || null,
        photos: p.paths,
        status: 'new',
        organisation_id: orgId,
        created_at: nowIso,
      });
      if (dbErr) throw new Error(`Quick Catch not saved: ${errorMessage(dbErr, 'lead failed')}`);
      progress.current = null;
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e, 'Quick Catch not saved. Check your connection and try again.'));
      setSaving(false);
    }
  };

  const reset = () => {
    progress.current = null;
    setBusinessName('');
    setAddress('');
    setSignCategory('Illuminated');
    setSignType('');
    setIssueType('');
    setNotes('');
    setError(null);
    setSaved(false);
    camera.clear();
  };

  // ── Success screen ──────────────────────────────────────────────────────────
  if (saved) {
    return (
      <Screen
        footer={
          <FlowFooter>
            <button className="btn btn-pri btn-xl btn-full" onClick={reset}><Zap aria-hidden />Log another</button>
            <button className="btn btn-lg btn-full" onClick={() => navigate('/routes')}>Done</button>
          </FlowFooter>
        }
      >
        <div className="text-center pt-5">
          <div className="w-[88px] h-[88px] rounded-full bg-oks text-ok grid place-items-center mx-auto mb-3">
            <Check className="w-12 h-12" aria-hidden />
          </div>
          <h1>Quick Catch logged</h1>
          <p className="sub">Added to BUILT CRM as a new lead.</p>
        </div>
      </Screen>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  const hint = !businessName.trim() ? 'Enter the business name.' : camera.photos.length === 0 ? 'Add at least one photo.' : null;

  return (
    <Screen
      footer={
        <FlowFooter hint={error ? null : hint}>
          {error && <p className="field-err text-center m-0" role="alert">{error}</p>}
          <FooterRow>
            <button className="btn" onClick={() => navigate(-1)} disabled={saving}>Cancel</button>
            <button className="btn btn-pri" onClick={handleSubmit} disabled={saving || hint !== null}>
              {saving ? <><span className="spin" aria-hidden />Saving…</> : <><Zap aria-hidden />Log Quick Catch</>}
            </button>
          </FooterRow>
        </FlowFooter>
      }
    >
      <h1>Quick Catch</h1>
      <p className="sub">A sign spotted outside a patrol. It goes straight to the CRM as a lead.</p>

      {/* GPS */}
      {gpsStatus === 'success' ? (
        <div className="flex gap-3 items-center rounded-2xl p-3.5 bg-oks">
          <CheckCircle2 className="w-7 h-7 text-ok flex-none" aria-hidden />
          <div className="flex-1 min-w-0">
            <b>Location captured</b>
            <small className="block text-mut text-sm tabular-nums">{latitude?.toFixed(5)}, {longitude?.toFixed(5)}</small>
          </div>
        </div>
      ) : gpsStatus === 'error' ? (
        <div className="flex gap-3 items-center rounded-2xl p-3.5 bg-accs" role="alert">
          <MapPinOff className="w-7 h-7 text-acc flex-none" aria-hidden />
          <div className="flex-1 min-w-0">
            <b>Location unavailable</b>
            <small className="block text-mut text-sm">{gpsErrorMessage}</small>
          </div>
          <button className="btn btn-sm" onClick={retryGPS}>Retry</button>
        </div>
      ) : (
        <div className="flex gap-3 items-center rounded-2xl p-3.5 bg-pris" role="status">
          <span className="spin text-prix" aria-hidden />
          <div className="flex-1"><b>Finding your location…</b></div>
        </div>
      )}

      <label className="field-label" htmlFor="qc-name">Business name</label>
      <input id="qc-name" className="input" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="As shown on the sign" autoCapitalize="words" />

      <label className="field-label" htmlFor="qc-addr">Address <span>(optional)</span></label>
      <input id="qc-addr" className="input" value={address} onChange={e => setAddress(e.target.value)} placeholder="Street number and name" autoCapitalize="words" />

      <h2 className="section-title">
        Photos <span className="tag-req">Required</span>
        {camera.photos.length > 0 && <span className="ml-auto text-sm text-mut font-bold">{camera.photos.length} added</span>}
      </h2>
      <div className="grid grid-cols-3 gap-2">
        {camera.photos.map((p, i) => (
          <div key={i} className="ph"><img src={p} alt={`Quick Catch photo ${i + 1}`} /></div>
        ))}
        <label className="ph ph-add">
          <Camera aria-hidden /><span>Take photo</span>
          <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={handleFiles} />
        </label>
        <label className="ph ph-add">
          <Upload aria-hidden /><span>Upload</span>
          <input type="file" accept="image/*" multiple className="sr-only" onChange={handleFiles} />
        </label>
      </div>

      <h2 className="section-title">Sign type</h2>
      <div className="seg" role="group" aria-label="Lighting">
        {SIGN_CATEGORIES.map(cat => (
          <button key={cat} type="button" aria-pressed={signCategory === cat} onClick={() => { setSignCategory(cat); setSignType(''); }}>
            {cat === 'Non-Illuminated' ? 'Non illuminated' : cat}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        {SIGN_TYPES[signCategory].map(opt => (
          <button
            key={opt}
            type="button"
            className="tile min-h-[56px] py-2.5 text-[15px] font-bold"
            aria-pressed={signType === opt}
            onClick={() => setSignType(prev => prev === opt ? '' : opt)}
          >
            {opt}
          </button>
        ))}
      </div>

      <h2 className="section-title">Issue <span className="tag-opt">Pick one</span></h2>
      <div className="grid gap-2.5" role="radiogroup" aria-label="Issue">
        {ISSUE_TYPES.map(it => (
          <button
            key={it}
            type="button"
            role="radio"
            aria-checked={issueType === it}
            className={`chk text-left ${issueType === it ? '!border-acc !bg-accs' : ''}`}
            onClick={() => setIssueType(prev => prev === it ? '' : it)}
          >
            <span className="box" style={issueType === it ? { background: 'var(--acc)', borderColor: 'var(--acc)', color: '#fff' } : undefined}>
              <Check aria-hidden />
            </span>
            {it}
          </button>
        ))}
      </div>

      <label className="field-label" htmlFor="qc-notes">Notes <span>(optional)</span></label>
      <textarea id="qc-notes" className="input" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Context, urgency, access notes" />
    </Screen>
  );
};

export default QuickCatchPage;

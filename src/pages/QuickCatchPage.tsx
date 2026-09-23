import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGPS } from '../hooks/useGPS';
import { useCamera } from '../hooks/useCamera';
import { supabase } from '../lib/supabase';
import { compressImage } from '../lib/imageUtils';
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
    if (camera.photos.length === 0) { setError('At least one photo is required.'); return; }
    setSaving(true);
    try {
      const leadId = crypto.randomUUID();

      // STEP A: Compress photos client-side — base64 data URLs work directly in CRM <img> tags
      const compressedPhotos: string[] = [];
      for (const dataUrl of camera.photos) {
        compressedPhotos.push(await compressImage(dataUrl));
      }

      // STEP B: Upload to storage in background (non-fatal, secondary path for inspection_photos)
      const uploadedUrls: string[] = [];
      for (const file of camera.files) {
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `quick-catch/${leadId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('patrol-photos')
          .upload(path, file, { upsert: false });
        if (!upErr) {
          const { data: { publicUrl } } = supabase.storage
            .from('patrol-photos')
            .getPublicUrl(path);
          uploadedUrls.push(publicUrl);
        }
      }

      // STEP C: Create sign_inspection stub (non-fatal)
      let inspectionId: string | null = null;
      try {
        const { data: inspData } = await supabase
          .from('sign_inspections')
          .insert({
            organisation_id: '8239bb55-2423-43c1-bb54-6370765f2275',
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
            inspected_at: new Date().toISOString(),
            date_logged: new Date().toISOString(),
          })
          .select('id')
          .single();
        if (inspData) inspectionId = inspData.id;
      } catch {
        // non-fatal — lead still gets created
      }

      // STEP D: Insert inspection_photos with storage URLs (non-fatal)
      if (inspectionId && uploadedUrls.length > 0) {
        try {
          await supabase.from('inspection_photos').insert(
            uploadedUrls.map(url => ({
              inspection_id: inspectionId,
              photo_url: url,
              photo_type: 'sign',
              created_at: new Date().toISOString(),
            }))
          );
        } catch {
          // non-fatal
        }
      }

      // STEP E: Insert lead with compressed base64 photos (guaranteed CRM-accessible)
      const { error: dbErr } = await supabase.from('leads').insert({
        id: leadId,
        source: 'PATROL_QUICK_CATCH',
        source_id: inspectionId,
        business_name: businessName.trim(),
        address: address.trim() || null,
        latitude,
        longitude,
        sign_category: signCategory,
        sign_type: signType || null,
        issue_type: issueType || null,
        notes: notes.trim() || null,
        photos: compressedPhotos,
        status: 'new',
        organisation_id: '8239bb55-2423-43c1-bb54-6370765f2275',
        created_at: new Date().toISOString(),
      });
      if (dbErr) throw dbErr;
      setSaved(true);
    } catch (e: any) {
      setError(e?.message ?? e?.details ?? JSON.stringify(e));
      setSaving(false);
    }
  };

  const reset = () => {
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

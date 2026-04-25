import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePatrolStore } from '../store/patrol.store';
import { useGPS } from '../hooks/useGPS';
import { useCamera } from '../hooks/useCamera';
import { supabase } from '../lib/supabase';
import { cls } from '../lib/ui';
import BottomNav from '../components/layout/BottomNav';
import { MapPin, Camera, Upload, Zap } from 'lucide-react';

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
  const { currentUser } = usePatrolStore();
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
      const { error: dbErr } = await supabase.from('leads').insert({
        id: crypto.randomUUID(),
        source: 'PATROL_QUICK_CATCH',
        business_name: businessName.trim(),
        address: address.trim() || null,
        latitude,
        longitude,
        sign_category: signCategory,
        sign_type: signType || null,
        issue_type: issueType || null,
        notes: notes.trim() || null,
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
      <div className="bg-[#0A0A0A] min-h-screen pb-20 flex flex-col items-center justify-center px-6 gap-8">
        <div className="w-20 h-20 rounded-full border-2 border-[#FCCA3B] flex items-center justify-center">
          <span className="text-[#FCCA3B] text-4xl font-black leading-none">✓</span>
        </div>

        <div className="text-center">
          <h1 className={`${cls.pageTitle} text-3xl mb-2`}>Lead Logged</h1>
          <p className={cls.muted}>
            <span className="inline-block w-2 h-2 bg-emerald-400 rounded-full mr-2 align-middle" />
            Added to BUILT CRM
          </p>
        </div>

        <div className="w-full max-w-sm space-y-3">
          <button onClick={reset} className={`${cls.btnPrimary} flex items-center justify-center gap-2`}>
            <Zap className="w-5 h-5" /> Log Another
          </button>
          <button
            onClick={() => navigate('/routes')}
            className={`${cls.btnGhost} w-full py-4 rounded-2xl text-base`}
          >
            ✓ Done
          </button>
        </div>
        <BottomNav />
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-[#0A0A0A] min-h-screen pb-20">
      {/* Header */}
      <div className="px-5 pt-14 pb-6">
        <p className={`${cls.stepHeader} mb-1`}>Opportunistic Find</p>
        <h1 className={cls.pageTitle}>Quick Catch</h1>
      </div>

      <div className="px-5 flex flex-col gap-6">
        {error && (
          <div className="bg-red-900/30 border border-red-500/40 text-red-400 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* Business name */}
        <div>
          <label className={cls.label}>Business Name *</label>
          <input
            type="text"
            value={businessName}
            onChange={e => setBusinessName(e.target.value)}
            placeholder="Enter business name"
            className="bg-[#1C1C1E] border border-[#2A2A2A] rounded-xl px-4 py-3 w-full text-white placeholder-[#8F8F8F] focus:border-[#FCCA3B] focus:outline-none text-sm"
            autoCapitalize="words"
          />
        </div>

        {/* Address */}
        <div>
          <label className={cls.label}>Address <span className="normal-case tracking-normal font-normal text-[#8F8F8F]">— optional</span></label>
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="e.g. 123 Main St"
            className="bg-[#1C1C1E] border border-[#2A2A2A] rounded-xl px-4 py-3 w-full text-white placeholder-[#8F8F8F] focus:border-[#FCCA3B] focus:outline-none text-sm"
            autoCapitalize="words"
          />
        </div>

        {/* GPS */}
        <div>
          <label className={cls.label}>Location</label>
          <div className="flex items-center gap-2 text-sm">
            {gpsStatus === 'capturing' && (
              <>
                <span className="w-3 h-3 rounded-full border-2 border-[#FCCA3B]/40 border-t-[#FCCA3B] animate-spin flex-shrink-0" />
                <span className={cls.muted}>Capturing GPS…</span>
              </>
            )}
            {gpsStatus === 'success' && (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="text-emerald-400 font-semibold text-xs">
                  {latitude?.toFixed(5)}, {longitude?.toFixed(5)}
                </span>
              </>
            )}
            {gpsStatus === 'error' && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <span className="text-red-400 text-xs">{gpsErrorMessage}</span>
                </div>
                <button onClick={retryGPS} className="text-[#FCCA3B] text-xs underline text-left">
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Photo */}
        <div>
          <label className={cls.label}>
            Photo *{camera.photos.length > 0 && (
              <span className="ml-2 text-[#FCCA3B] normal-case">
                {camera.photos.length} captured
              </span>
            )}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={`flex flex-col items-center justify-center gap-2 h-20 rounded-xl border-2 cursor-pointer transition-colors ${
              camera.photos.length > 0
                ? 'border-[#FCCA3B]/40 bg-[#FCCA3B]/5'
                : 'border-[#2A2A2A] hover:border-[#FCCA3B]/40'
            }`}>
              <Camera className="w-5 h-5 text-[#8F8F8F]" />
              <span className="text-xs text-[#8F8F8F]">Take Photo</span>
              <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={handleFiles} />
            </label>
            <label className={`flex flex-col items-center justify-center gap-2 h-20 rounded-xl border-2 cursor-pointer transition-colors ${
              camera.photos.length > 0
                ? 'border-[#FCCA3B]/40 bg-[#FCCA3B]/5'
                : 'border-[#2A2A2A] hover:border-[#FCCA3B]/40'
            }`}>
              <Upload className="w-5 h-5 text-[#8F8F8F]" />
              <span className="text-xs text-[#8F8F8F]">Upload Photo</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
            </label>
          </div>
          {camera.photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-3">
              {camera.photos.map((p, i) => (
                <img key={i} src={p} alt={`catch-${i}`} className="w-full aspect-square object-cover rounded-xl border border-[#2A2A2A]" />
              ))}
            </div>
          )}
        </div>

        {/* Sign category pills */}
        <div>
          <label className={cls.label}>Sign Category</label>
          <div className="flex gap-3">
            {SIGN_CATEGORIES.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => { setSignCategory(cat); setSignType(''); }}
                className={`${cls.chip} flex-1 ${signCategory === cat ? cls.chipActive : cls.chipIdle}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Sign type grid */}
        <div>
          <label className={cls.label}>Sign Type</label>
          <div className="grid grid-cols-2 gap-2">
            {SIGN_TYPES[signCategory].map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => setSignType(prev => prev === opt ? '' : opt)}
                className={`py-3 px-3 rounded-xl text-xs font-semibold text-left transition-colors border ${
                  signType === opt
                    ? 'border-[#FCCA3B] bg-[#FCCA3B]/5 text-white'
                    : 'border-[#2A2A2A] text-[#8F8F8F] hover:border-[#FCCA3B]/30'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Issue type */}
        <div>
          <label className={cls.label}>Issue Type</label>
          <div className="flex flex-col gap-2">
            {ISSUE_TYPES.map(it => (
              <button
                key={it}
                type="button"
                onClick={() => setIssueType(prev => prev === it ? '' : it)}
                className={`py-3.5 px-4 rounded-xl text-sm font-semibold text-left transition-colors border ${
                  issueType === it
                    ? 'border-[#FCCA3B] bg-[#FCCA3B]/5 text-white'
                    : 'border-[#2A2A2A] text-[#8F8F8F] hover:border-[#FCCA3B]/30'
                }`}
              >
                {it}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className={cls.label}>Notes (optional)</label>
          <textarea
            className="bg-[#1C1C1E] border border-[#2A2A2A] rounded-xl px-4 py-3 w-full text-white placeholder-[#8F8F8F] focus:border-[#FCCA3B] focus:outline-none text-sm resize-none"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Additional context, urgency, access notes…"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={saving}
          className={cls.btnPrimary}
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              Saving…
            </span>
          ) : <span className="flex items-center justify-center gap-2"><Zap className="w-5 h-5" /> Log Quick Catch</span>}
        </button>
      </div>

      <BottomNav />
    </div>
  );
};

export default QuickCatchPage;

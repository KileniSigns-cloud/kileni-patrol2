import React, { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { useGPS } from '../hooks/useGPS';
import { cls, C } from '../lib/ui';
import TimerBar from '../components/layout/TimerBar';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';

const AddBusinessPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessionId: activeSessionId, setBusinessId, setBusinessName } = usePatrolSession();

  const { latitude, longitude, accuracy, status: gpsStatus, errorMessage: gpsErrorMessage, retry: retryGPS } = useGPS();

  const [businessName, setBusinessNameInput] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Submit state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  if (!activeSessionId) {
    return (
      <div className={`${cls.page} items-center justify-center gap-4 px-6`}>
        <p className={cls.muted}>No active patrol session.</p>
        <button onClick={() => navigate('/routes')} className="text-yellow-500 text-sm underline">
          Back to Routes
        </button>
      </div>
    );
  }

  const showErrorToast = (msg: string) => {
    setError(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setError(null), 4000);
  };

  const handleSave = async () => {
    setLoading(true);
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
      navigate('/photos/' + sessionId);
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to save. Tap to retry.');
      setLoading(false);
    }
  };

  const inputCls = 'bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl px-4 py-3 w-full text-white placeholder-[#8F8F8F] focus:border-[#FCCA3B] focus:outline-none text-sm';

  return (
    <div className={cls.page}>
      <TimerBar showBack={false} showCancel={false} />

      {/* Top bar */}
      <div className="pt-16 px-5 flex justify-between items-center">
        <button
          onClick={() => navigate(`/patrol/${sessionId}`)}
          className="flex items-center gap-1 text-[#8F8F8F] text-sm"
        >
          <ChevronLeft className="w-5 h-5" /> Back
        </button>
        <span className="text-xs font-semibold text-[#8F8F8F]">4 OF 9</span>
      </div>

      {/* Header */}
      <div className="px-5 mt-6">
        <p className="text-xs tracking-widest text-[#FCCA3B] uppercase">LOCATE BUSINESS</p>
        <h1 className="font-black text-3xl text-white mt-1">Add Business</h1>
      </div>

      <div className="flex-1 px-5 overflow-y-auto pb-32">

        {/* Business name */}
        <div className="bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-5 mt-6">
          <label className="block text-xs font-bold tracking-widest text-[#8F8F8F] mb-3">BUSINESS NAME</label>
          <input
            type="text"
            placeholder="e.g. Tim Hortons"
            value={businessName}
            onChange={e => setBusinessNameInput(e.target.value)}
            className={inputCls}
          />
        </div>

        {/* GPS card */}
        <div className="bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-5 mt-6">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-5 h-5 text-[#FCCA3B]" />
            <label className="text-xs font-bold tracking-widest text-[#8F8F8F]">LOCATION</label>
          </div>

          {gpsStatus === 'idle' && (
            <button
              onClick={retryGPS}
              className="border border-[#FCCA3B] text-[#FCCA3B] rounded-full px-6 py-2 text-sm font-semibold hover:opacity-80 active:opacity-60 transition-opacity"
            >
              Get GPS Location
            </button>
          )}

          {gpsStatus === 'capturing' && (
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-[#FCCA3B] border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span className="text-sm text-[#8F8F8F]">Getting location…</span>
            </div>
          )}

          {gpsStatus === 'success' && latitude !== null && longitude !== null && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-[#30D158] rounded-full flex-shrink-0" />
                <span className="text-white text-sm font-semibold">Location acquired</span>
              </div>
              <p className="font-mono text-xs text-[#8F8F8F]">
                {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </p>
              <div className="flex items-center gap-2">
                {accuracy !== null && (
                  <span className="bg-[#0A0A0A] border border-[#2A2A2A] text-xs rounded-full px-2 py-0.5 text-[#8F8F8F]">
                    ±{accuracy}m
                  </span>
                )}
                <button onClick={retryGPS} className="text-xs text-[#FCCA3B] underline ml-1">
                  Retry
                </button>
              </div>
            </div>
          )}

          {gpsStatus === 'error' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-red-400">Location unavailable</span>
              </div>
              <p className="text-xs text-[#8F8F8F] leading-relaxed">{gpsErrorMessage}</p>
              <button
                onClick={retryGPS}
                className="border border-[#FCCA3B] text-[#FCCA3B] rounded-full px-6 py-2 text-sm font-semibold hover:opacity-80 active:opacity-60 transition-opacity"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Address */}
        <div className="bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-5 mt-6">
          <label className="block text-xs font-bold tracking-widest text-[#8F8F8F] mb-3">ADDRESS</label>
          <input
            type="text"
            placeholder="e.g. 123 Yonge St"
            value={address}
            onChange={e => setAddress(e.target.value)}
            className={inputCls}
          />
        </div>

        {/* Notes */}
        <div className="bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-5 mt-6">
          <label className="block text-xs font-bold tracking-widest text-[#8F8F8F] mb-3">NOTES</label>
          <textarea
            placeholder="Any additional details about this location…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className={`${inputCls} h-24 resize-none`}
          />
        </div>
      </div>

      {/* Error toast — tappable to retry */}
      {error && (
        <button
          onClick={handleSave}
          className="fixed bottom-4 left-4 right-4 z-50 bg-[#FF3B30] text-white rounded-2xl p-4 text-sm font-semibold text-left"
        >
          {error}
        </button>
      )}

      {/* Bottom action */}
      <div className={cls.bottomBar}>
        <button
          onClick={handleSave}
          disabled={loading}
          className={cls.btnPrimary}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Saving…
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1.5">Save & Add Photos <ChevronRight className="w-5 h-5" /></span>
          )}
        </button>
      </div>
    </div>
  );
};

export default AddBusinessPage;

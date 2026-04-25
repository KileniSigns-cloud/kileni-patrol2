import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { cls, C } from '../lib/ui';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { usePatrolStore } from '../store/patrol.store';
import TimerBar from '../components/layout/TimerBar';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const MAX_SIGN = 8;
const MAX_SURROUNDING = 4;

const PhotoUploadPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessionId: activeSessionId, setPhotoUrls } = usePatrolSession();
  const { currentUser } = usePatrolStore();

  const [signFiles, setSignFiles] = useState<File[]>([]);
  const [surroundingFiles, setSurroundingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Stable refs — top level, never conditional
  const signInputRef = useRef<HTMLInputElement>(null);
  const surroundingInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!error) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setError(null), 4000);
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [error]);

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

  const totalFiles = signFiles.length + surroundingFiles.length;
  const progressPct = uploadTotal > 0 ? Math.round((uploadCount / uploadTotal) * 100) : 0;

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    category: 'sign' | 'surrounding'
  ) => {
    const max = category === 'sign' ? MAX_SIGN : MAX_SURROUNDING;
    const existing = category === 'sign' ? signFiles.length : surroundingFiles.length;
    const picked = Array.from(e.target.files ?? []).slice(0, max - existing);
    e.target.value = '';
    if (!picked.length) return;
    if (category === 'sign') setSignFiles(prev => [...prev, ...picked].slice(0, MAX_SIGN));
    else setSurroundingFiles(prev => [...prev, ...picked].slice(0, MAX_SURROUNDING));
  };

  const removeFile = (category: 'sign' | 'surrounding', index: number) => {
    if (category === 'sign') setSignFiles(prev => prev.filter((_, i) => i !== index));
    else setSurroundingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadFile = async (file: File): Promise<string | null> => {
    if (!sessionId) return null;
    const path = `inspections/${sessionId}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from('patrol-photos')
      .upload(path, file, { upsert: false });
    if (uploadError) {
      setError(`Upload failed: ${uploadError.message}`);
      return null;
    }
    return supabase.storage.from('patrol-photos').getPublicUrl(path).data.publicUrl;
  };

  const handleContinue = async () => {
    if (!currentUser || !sessionId || signFiles.length === 0) return;
    setError(null);
    setUploading(true);
    setUploadCount(0);
    setUploadTotal(totalFiles);

    const signUrls: string[] = [];
    for (const file of signFiles) {
      const url = await uploadFile(file);
      if (url) signUrls.push(url);
      setUploadCount(prev => prev + 1);
    }

    const surroundingUrls: string[] = [];
    for (const file of surroundingFiles) {
      const url = await uploadFile(file);
      if (url) surroundingUrls.push(url);
      setUploadCount(prev => prev + 1);
    }

    setUploading(false);

    if (signUrls.length === 0) {
      setError('No sign photos uploaded. Check your connection and try again.');
      return;
    }

    setPhotoUrls(signUrls, surroundingUrls);
    navigate(`/patrol-type/${sessionId}`);
  };

  const PhotoGrid = ({
    files,
    category,
    max,
    inputRef,
  }: {
    files: File[];
    category: 'sign' | 'surrounding';
    max: number;
    inputRef: React.RefObject<HTMLInputElement>;
  }) => (
    <div className="grid grid-cols-3 gap-2">
      {files.map((file, i) => (
        <div key={i} className="relative aspect-square rounded-xl overflow-hidden bg-gray-800 shadow-lg">
          <img
            src={URL.createObjectURL(file)}
            alt={`${category} ${i + 1}`}
            className="w-full h-full object-cover"
          />
          <button
            onClick={() => removeFile(category, i)}
            className="absolute top-1 right-1 w-5 h-5 bg-[#FF3B30] rounded-full flex items-center justify-center text-white text-xs leading-none"
          >
            ×
          </button>
        </div>
      ))}
      {files.length < max && (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="border-2 border-dashed border-[#2A2A2A] rounded-xl aspect-square flex flex-col items-center justify-center hover:border-[#FCCA3B]/60 transition-colors active:scale-[0.97] disabled:opacity-40"
        >
          <span className="text-2xl text-[#FCCA3B]">📷</span>
          <span className="text-[#8F8F8F] text-xs mt-1">Add</span>
        </button>
      )}
    </div>
  );

  return (
    <div className={cls.page}>
      <TimerBar showBack={false} showCancel={false} />

      {/* Hidden stable file inputs — always in DOM, never conditional */}
      <input ref={signInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => handleFileChange(e, 'sign')} />
      <input ref={surroundingInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => handleFileChange(e, 'surrounding')} />

      {/* Top bar */}
      <div className="pt-16 px-5 flex justify-between items-center">
        <button
          onClick={() => navigate(`/add-business/${sessionId}`)}
          className="flex items-center gap-1 text-[#8F8F8F] text-sm"
        >
          <ChevronLeft className="w-5 h-5" /> Back
        </button>
        <span className="text-xs font-semibold text-[#8F8F8F]">5 OF 9</span>
      </div>

      {/* Page header */}
      <div className="px-5 mt-6 pb-2">
        <p className="text-xs tracking-widest text-[#FCCA3B] uppercase">CAPTURE EVIDENCE</p>
        <h1 className="font-black text-3xl text-white mt-1">Sign Photos</h1>
      </div>

      {/* Upload progress */}
      {uploading && (
        <div className="px-5 pb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs" style={{ color: C.muted }}>
              Uploading {Math.min(uploadCount + 1, uploadTotal)} of {uploadTotal}…
            </span>
            <span className="text-xs font-mono text-[#FCCA3B]">{progressPct}%</span>
          </div>
          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#FCCA3B] rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Photo sections */}
      <div className="flex-1 px-5 space-y-4 overflow-y-auto pb-32">

        {/* Sign photos */}
        <div className={cls.card}>
          <div className="flex items-baseline gap-1.5 mb-3">
            <p className={cls.cardTitle}>Sign Photos</p>
            <span className="text-[#FF3B30] text-sm leading-none">*</span>
            <span className="text-xs" style={{ color: C.muted }}>(min 1)</span>
            {signFiles.length > 0 && (
              <span className="ml-auto text-xs font-mono text-[#FCCA3B]">{signFiles.length}/{MAX_SIGN}</span>
            )}
          </div>
          <PhotoGrid files={signFiles} category="sign" max={MAX_SIGN} inputRef={signInputRef} />
        </div>

        {/* Surrounding photos */}
        <div className={cls.card}>
          <div className="flex items-baseline gap-1.5 mb-3">
            <p className={cls.cardTitle}>Surroundings</p>
            <span className="text-xs" style={{ color: C.muted }}>(optional)</span>
            {surroundingFiles.length > 0 && (
              <span className="ml-auto text-xs font-mono text-[#FCCA3B]">{surroundingFiles.length}/{MAX_SURROUNDING}</span>
            )}
          </div>
          <PhotoGrid files={surroundingFiles} category="surrounding" max={MAX_SURROUNDING} inputRef={surroundingInputRef} />
        </div>
      </div>

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-24 left-4 right-4 z-50 bg-[#FF3B30] text-white rounded-2xl p-4 text-sm font-semibold flex items-center justify-between gap-3">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-white/70 hover:text-white text-lg leading-none">×</button>
        </div>
      )}

      {/* Bottom action */}
      <div className={cls.bottomBar}>
        <button
          onClick={handleContinue}
          disabled={uploading || signFiles.length === 0}
          className={`${cls.btnPrimary} flex items-center justify-center gap-2`}
        >
          {uploading ? (
            <>
              <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
              Uploading {Math.min(uploadCount + 1, uploadTotal)} of {uploadTotal}…
            </>
          ) : (
            <span className="flex items-center justify-center gap-1.5">Continue <ChevronRight className="w-5 h-5" /></span>
          )}
        </button>
      </div>
    </div>
  );
};

export default PhotoUploadPage;

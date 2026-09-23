import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, Check, Store, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { compressImage } from '../lib/imageUtils';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { usePatrolStore } from '../store/patrol.store';
import { skipsPatrolType } from '../lib/signFlow';
import Screen from '../components/layout/Screen';
import StepProgress from '../components/flow/StepProgress';
import FlowFooter, { FooterRow } from '../components/flow/FlowFooter';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import NoSession from '../components/flow/NoSession';

const MAX_SIGN = 8;
const MAX_SURROUNDING = 4;

type Category = 'sign' | 'surrounding';

/** Object URLs for previews, revoked when the files change or the page unmounts. */
function usePreviews(files: File[]): string[] {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

const PhotoUploadPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessionId: activeSessionId, setPhotoUrls, reusingBusiness, patrolType, businessName } = usePatrolSession();
  const { currentUser } = usePatrolStore();

  const [signFiles, setSignFiles] = useState<File[]>([]);
  const [surroundingFiles, setSurroundingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [toRemove, setToRemove] = useState<{ category: Category; index: number } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Stable refs — top level, never conditional
  const signInputRef = useRef<HTMLInputElement>(null);
  const surroundingInputRef = useRef<HTMLInputElement>(null);

  const signPreviews = usePreviews(signFiles);
  const surroundingPreviews = usePreviews(surroundingFiles);

  if (!activeSessionId) return <NoSession />;

  const totalFiles = signFiles.length + surroundingFiles.length;
  const skip = skipsPatrolType({ reusingBusiness, patrolType });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, category: Category) => {
    const max = category === 'sign' ? MAX_SIGN : MAX_SURROUNDING;
    const existing = category === 'sign' ? signFiles.length : surroundingFiles.length;
    const picked = Array.from(e.target.files ?? []).slice(0, max - existing);
    e.target.value = '';
    if (!picked.length) return;
    if (category === 'sign') setSignFiles(prev => [...prev, ...picked].slice(0, MAX_SIGN));
    else setSurroundingFiles(prev => [...prev, ...picked].slice(0, MAX_SURROUNDING));
  };

  const removeFile = (category: Category, index: number) => {
    if (category === 'sign') setSignFiles(prev => prev.filter((_, i) => i !== index));
    else setSurroundingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const uploadFile = async (file: File): Promise<string | null> => {
    if (!sessionId) return null;
    const path = `inspections/${sessionId}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from('patrol-photos')
      .upload(path, file, { upsert: false });
    if (uploadError) return null;
    return supabase.storage.from('patrol-photos').getPublicUrl(path).data.publicUrl;
  };

  const handleContinue = async () => {
    if (!currentUser || !sessionId || signFiles.length === 0) return;
    setUploading(true);
    setUploadCount(0);
    setUploadTotal(totalFiles);

    // Compress files to base64 — guaranteed to work as CRM <img> src
    const signBase64: string[] = [];
    for (const file of signFiles) {
      const raw = await fileToBase64(file);
      signBase64.push(await compressImage(raw));
      setUploadCount(prev => prev + 1);
    }

    const surroundingBase64: string[] = [];
    for (const file of surroundingFiles) {
      const raw = await fileToBase64(file);
      surroundingBase64.push(await compressImage(raw));
      setUploadCount(prev => prev + 1);
    }

    setUploading(false);

    // Upload to storage in background (non-fatal — only needed for inspection_photos secondary path)
    for (const file of [...signFiles, ...surroundingFiles]) {
      uploadFile(file).catch(() => {});
    }

    setPhotoUrls(signBase64, surroundingBase64);
    // Logging another sign at the same business keeps its patrol type, so step 6 is skipped.
    navigate(skip ? `/sign-type/${sessionId}` : `/patrol-type/${sessionId}`);
  };

  const back = () => {
    if (!reusingBusiness) return navigate(`/add-business/${sessionId}`);
    // Same business: leaving discards this sign only.
    if (totalFiles > 0) setConfirmDiscard(true);
    else navigate(`/patrol/${sessionId}`);
  };

  const grid = (category: Category, previews: string[], max: number, inputRef: React.RefObject<HTMLInputElement>) => (
    <div className="grid grid-cols-3 gap-2">
      {previews.map((url, i) => (
        <div key={url} className="ph">
          <img src={url} alt={`${category === 'sign' ? 'Sign' : 'Surroundings'} photo ${i + 1}`} />
          <span className="ph-badge"><Check aria-hidden />Ready</span>
          <button
            className="ph-rm"
            onClick={() => setToRemove({ category, index: i })}
            disabled={uploading}
            aria-label={`Remove ${category === 'sign' ? 'sign' : 'surroundings'} photo ${i + 1}`}
          >
            <X aria-hidden />
          </button>
        </div>
      ))}
      {previews.length < max && (
        <button className="ph ph-add" onClick={() => inputRef.current?.click()} disabled={uploading}>
          <Camera aria-hidden />
          <span>{previews.length ? 'Add' : 'Take photo'}</span>
        </button>
      )}
    </div>
  );

  return (
    <Screen
      footer={
        <FlowFooter hint={signFiles.length === 0 ? 'Add at least one sign photo to continue.' : null}>
          <FooterRow>
            <button className="btn" onClick={back} disabled={uploading}>{reusingBusiness ? 'Cancel' : 'Back'}</button>
            <button className="btn btn-pri" onClick={handleContinue} disabled={uploading || signFiles.length === 0}>
              {uploading
                ? <><span className="spin" aria-hidden />Processing {Math.min(uploadCount + 1, uploadTotal)} of {uploadTotal}…</>
                : `Next: ${skip ? 'sign type' : 'patrol type'}`}
            </button>
          </FooterRow>
        </FlowFooter>
      }
    >
      {/* Hidden stable file inputs — always in DOM, never conditional */}
      <input ref={signInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => handleFileChange(e, 'sign')} />
      <input ref={surroundingInputRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => handleFileChange(e, 'surrounding')} />

      <StepProgress step={1} />
      {reusingBusiness && (
        <p className="inline-flex gap-1.5 items-center bg-sf2 rounded-full px-3 py-1.5 font-bold text-sm mt-2.5 mb-0">
          <Store className="w-4 h-4" aria-hidden />{businessName || 'Unnamed business'}
        </p>
      )}
      <h1>Photos</h1>
      <p className="sub">At least one clear shot of the sign. Photos are saved when you tap Next.</p>

      <h2 className="section-title">
        Sign photos <span className="tag-req">Required</span>
        <span className="ml-auto text-sm text-mut font-bold tabular-nums">{signFiles.length}/{MAX_SIGN}</span>
      </h2>
      {grid('sign', signPreviews, MAX_SIGN, signInputRef)}

      <h2 className="section-title">
        Surroundings <span className="tag-opt">Optional</span>
        <span className="ml-auto text-sm text-mut font-bold tabular-nums">{surroundingFiles.length}/{MAX_SURROUNDING}</span>
      </h2>
      {grid('surrounding', surroundingPreviews, MAX_SURROUNDING, surroundingInputRef)}

      <ConfirmDialog
        open={toRemove !== null}
        danger
        title="Remove photo?"
        message="It will be removed from this sign."
        confirmLabel="Remove"
        onConfirm={() => { if (toRemove) removeFile(toRemove.category, toRemove.index); setToRemove(null); }}
        onCancel={() => setToRemove(null)}
      />
      <ConfirmDialog
        open={confirmDiscard}
        danger
        title="Discard this sign?"
        message="Photos for this sign will be removed. Businesses already logged stay on the patrol."
        confirmLabel="Discard"
        onConfirm={() => navigate(`/patrol/${sessionId}`)}
        onCancel={() => setConfirmDiscard(false)}
      />
    </Screen>
  );
};

export default PhotoUploadPage;

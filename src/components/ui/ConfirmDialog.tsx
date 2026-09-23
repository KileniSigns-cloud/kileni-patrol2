import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Red confirm button for destructive actions (end patrol, discard, remove, archive). */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Bottom sheet on phones, centred dialog from 600px. Esc, overlay tap and Cancel all dismiss. */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open, title, message, confirmLabel, danger = false, busy = false, onConfirm, onCancel,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus(); // safest default for a destructive choice
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center min-[600px]:items-center p-4 bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="w-full max-w-[440px] bg-sf rounded-[22px] p-[22px] shadow-[0_20px_60px_rgba(0,0,0,.3)]"
      >
        <h2 id="confirm-title" className="m-0 text-xl font-extrabold">{title}</h2>
        <p id="confirm-message" className="text-mut mt-2 mb-5">{message}</p>
        <div className="flex gap-2.5">
          <button ref={cancelRef} className="btn flex-1" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`btn flex-[2] ${danger ? 'btn-danger' : 'btn-pri'}`} onClick={onConfirm} disabled={busy}>
            {busy ? <><span className="spin" aria-hidden />Working…</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;

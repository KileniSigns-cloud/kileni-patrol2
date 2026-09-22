import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Centred modal (80vw, capped) over a dimmed overlay. Esc, overlay tap and Cancel all dismiss. */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open, title, message, confirmLabel, busy = false, onConfirm, onCancel,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={() => !busy && onCancel()} aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="relative w-[80vw] max-w-md bg-[#1C1C1E] border border-[#2A2A2A] rounded-2xl p-6 shadow-2xl"
      >
        <h2 id="confirm-title" className="text-lg font-black text-white">{title}</h2>
        <p id="confirm-message" className="mt-2 text-sm text-[#8F8F8F] leading-relaxed">{message}</p>
        <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="min-h-12 px-5 rounded-xl border border-[#2A2A2A] text-white font-semibold hover:border-[#8F8F8F] disabled:opacity-50 transition-colors active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FCCA3B]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="min-h-12 px-5 rounded-xl bg-[#FCCA3B] text-black font-black hover:brightness-110 disabled:opacity-60 transition active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FCCA3B]"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;

import { create } from 'zustand';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

type ToastKind = 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  show: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

const AUTO_DISMISS_MS = 3000;
let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (kind, message) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, kind, message }] });
    setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (message: string) => useToastStore.getState().show('success', message),
  error: (message: string) => useToastStore.getState().show('error', message),
};

/** Mounted once in App. Top right, closes after 3 s. */
export const Toaster: React.FC = () => {
  const { toasts, dismiss } = useToastStore();
  return (
    <div
      aria-live="polite"
      className="fixed right-3 z-30 flex flex-col items-end gap-2 pointer-events-none max-w-[calc(100%-24px)]"
      style={{ top: 'calc(12px + env(safe-area-inset-top, 0px))' }}
    >
      {toasts.map((t) => {
        const ok = t.kind === 'success';
        const Icon = ok ? CheckCircle2 : AlertTriangle;
        return (
          <div
            key={t.id}
            role={ok ? 'status' : 'alert'}
            className="pointer-events-auto flex items-center gap-2 rounded-[14px] pl-4 pr-1 py-1 font-bold bg-tx text-bg shadow-[0_10px_30px_rgba(0,0,0,.25)]"
          >
            <Icon className={`w-[18px] h-[18px] flex-none ${ok ? 'text-ok' : 'text-acc'}`} aria-hidden />
            <span className="py-2">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="w-12 h-12 grid place-items-center rounded-full border-0 bg-transparent text-bg cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
};

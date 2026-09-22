import { create } from 'zustand';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

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

/** Mounted once in App. Top-right on wide screens, full-width at the top on phones. */
export const Toaster: React.FC = () => {
  const { toasts, dismiss } = useToastStore();
  return (
    <div
      aria-live="polite"
      className="fixed top-[max(1rem,env(safe-area-inset-top))] left-4 right-4 sm:left-auto sm:w-96 z-[100] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => {
        const ok = t.kind === 'success';
        const Icon = ok ? CheckCircle2 : AlertTriangle;
        return (
          <div
            key={t.id}
            role={ok ? 'status' : 'alert'}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-xl bg-[#1C1C1E] ${
              ok ? 'border-emerald-500/40' : 'border-red-500/50'
            }`}
          >
            <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${ok ? 'text-emerald-400' : 'text-red-400'}`} aria-hidden />
            <p className="flex-1 text-sm text-white leading-snug">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="-m-2 w-12 h-12 flex items-center justify-center rounded-full text-[#8F8F8F] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FCCA3B]"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
};

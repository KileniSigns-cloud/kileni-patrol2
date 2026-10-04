import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { ZoneInfoData } from '../../lib/zoneInfo';
import ZoneInfo from './ZoneInfo';
import { LoadError } from '../ui/EmptyState';

interface ZoneInfoSheetProps {
  open: boolean;
  onClose: () => void;
  /** null while loading. */
  zone: ZoneInfoData | null;
  error: string | null;
  onRetry: () => void;
}

/** A drag further than this, or a quick flick, closes the sheet. */
const CLOSE_DISTANCE = 80;
const CLOSE_VELOCITY = 0.5; // px per ms

/**
 * Bottom sheet with the zone's info in large type. Closes on swipe down (from the handle, or
 * anywhere while the content is scrolled to the top), Close, Esc, or a tap on the backdrop.
 * Swiping is never required: Close is a full-size button. Read-only: opening it changes
 * nothing in the patrol.
 */
const ZoneInfoSheet: React.FC<ZoneInfoSheetProps> = ({ open, onClose, zone, error, onRetry }) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; t: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Read through a ref so a parent re-render (new onClose) doesn't re-run the open effect.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      setDy(0);
      returnTo?.focus();
    };
  }, [open]);

  if (!open) return null;

  const start = (x: number, y: number) => { drag.current = { x, y, t: performance.now() }; };
  const move = (x: number, y: number) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(x - d.x) > Math.abs(y - d.y) && Math.abs(x - d.x) > 10) { drag.current = null; setDragging(false); setDy(0); return; }
    setDragging(true);
    setDy(Math.max(0, y - d.y));
  };
  const end = (y: number) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    const dist = y - d.y;
    const speed = dist / Math.max(1, performance.now() - d.t);
    if (dist > CLOSE_DISTANCE || (dist > 20 && speed > CLOSE_VELOCITY)) onClose();
    else setDy(0);
  };

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full max-w-[560px] max-h-[88dvh] flex flex-col bg-sf text-tx rounded-t-[22px] shadow-[0_-10px_40px_rgba(0,0,0,.3)] ${
          dragging ? '' : 'transition-transform duration-200 motion-reduce:transition-none'
        }`}
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
        onTouchStart={(e) => { if ((bodyRef.current?.scrollTop ?? 0) <= 0) start(e.touches[0].clientX, e.touches[0].clientY); }}
        onTouchMove={(e) => move(e.touches[0].clientX, e.touches[0].clientY)}
        onTouchEnd={(e) => end(e.changedTouches[0].clientY)}
        onTouchCancel={() => { drag.current = null; setDragging(false); setDy(0); }}
      >
        <div
          className="flex-none px-4 pt-2 pb-3 touch-none cursor-grab"
          onPointerDown={(e) => { if (e.pointerType === 'mouse' && e.target === e.currentTarget) { e.currentTarget.setPointerCapture(e.pointerId); start(e.clientX, e.clientY); } }}
          onPointerMove={(e) => { if (e.pointerType === 'mouse') move(e.clientX, e.clientY); }}
          onPointerUp={(e) => { if (e.pointerType === 'mouse') end(e.clientY); }}
        >
          <div className="mx-auto w-10 h-1.5 rounded-full bg-line" aria-hidden />
          <div className="flex items-center justify-between gap-3 mt-2">
            <h2 id={titleId} className="m-0 text-[22px] font-extrabold">Zone info</h2>
            <button ref={closeRef} type="button" className="btn btn-lg flex-none" onClick={onClose}>
              <X aria-hidden />Close
            </button>
          </div>
        </div>
        <div
          ref={bodyRef}
          className="flex-1 overflow-y-auto overscroll-contain px-4"
          style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))' }}
        >
          {error ? (
            <LoadError message={error} onRetry={onRetry} />
          ) : zone ? (
            <ZoneInfo zone={zone} large titleAs="h3" />
          ) : (
            <div aria-busy="true">
              <div className="skeleton h-8 w-24" />
              <div className="skeleton h-24 mt-3" />
              <div className="skeleton h-16 mt-3" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ZoneInfoSheet;

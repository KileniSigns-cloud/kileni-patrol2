import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, Map as MapIcon, MapPin, Plus, Trash2 } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import { DuplicateCodeError } from '../lib/routesApi';
import {
  AREA_TYPE_SUGGESTIONS, CAPS, draftCorners, emptyZoneForm, hasErrors, parseGps, toZoneRow, validateZoneForm, zoneFormFrom,
  type AnchorDraft, type CornerDraft, type ZoneFormErrors, type ZoneFormValues,
} from '../lib/zoneForm';
import { MAX_CORNERS, MIN_CORNERS, cornerMapsUrl, loopLabel, zoneMapUrl, zoneMapWarnings } from '../lib/zoneInfo';
import { errorMessage } from '../lib/errors';
import Screen from '../components/layout/Screen';
import AdminHeader from '../components/admin/AdminHeader';
import { LoadError } from '../components/ui/EmptyState';
import { ZONE_MAP_NOTE } from '../components/zone/ZoneInfo';
import { toast } from '../components/ui/Toast';

type Field = 'code' | 'name' | 'area_type' | 'focus' | 'est_minutes';

/**
 * Create or edit a zone: code, name, area type, 4 to 8 corners (intersection + optional GPS
 * pasted as "lat,lng"), anchors, focus and an estimate. Values are trimmed and normalised before
 * saving (the DB rejects untrimmed text). The zone map link is previewed live from the corners.
 */
const ZoneFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { routeId } = useParams<{ routeId: string }>();
  const editing = routeId !== undefined;
  const { createZone, updateZone, getZone } = usePatrolStore();

  const [values, setValues] = useState<ZoneFormValues>(emptyZoneForm);
  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [errors, setErrors] = useState<ZoneFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fieldRefs = useRef<Partial<Record<Field, HTMLElement | null>>>({});
  const listId = useId();

  useEffect(() => {
    if (!routeId) return;
    let live = true;
    setLoading(true);
    setLoadError(null);
    getZone(routeId)
      .then((z) => { if (live) setValues(zoneFormFrom(z)); })
      .catch((e) => { if (live) setLoadError(errorMessage(e, 'Could not load the zone.')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [routeId, getZone, reload]);

  const set = <K extends keyof ZoneFormValues>(key: K, value: ZoneFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };
  const setCorner = (i: number, patch: Partial<CornerDraft>) =>
    set('corners', values.corners.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const moveCorner = (i: number, by: -1 | 1) => {
    const next = [...values.corners];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    set('corners', next);
  };
  const setAnchor = (i: number, patch: Partial<AnchorDraft>) =>
    set('anchors', values.anchors.map((a, k) => (k === i ? { ...a, ...patch } : a)));

  const preview = draftCorners(values.corners);
  const mapUrl = preview.length === values.corners.length ? zoneMapUrl(preview) : null;
  const warnings = preview.length === values.corners.length ? zoneMapWarnings(preview) : [];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    const found = validateZoneForm(values);
    setErrors(found);
    if (hasErrors(found)) {
      const first = (['code', 'name', 'area_type', 'focus', 'est_minutes'] as const).find((f) => found[f]);
      if (first) fieldRefs.current[first]?.focus();
      else setFormError('Fix the corners or anchors marked below.');
      return;
    }

    setSubmitting(true);
    try {
      const row = toZoneRow(values);
      const zone = editing ? await updateZone(routeId, row) : await createZone(row);
      toast.success(`${editing ? 'Saved' : 'Created'} ${zone.code} ${zone.name}`);
      navigate('/admin/routes', { replace: true });
    } catch (err) {
      if (err instanceof DuplicateCodeError) {
        setErrors({ code: err.message });
        fieldRefs.current.code?.focus();
      } else {
        setFormError(errorMessage(err, editing ? 'Could not save the zone.' : 'Could not create the zone.'));
      }
      setSubmitting(false);
    }
  };

  const header = (
    <AdminHeader
      back={{ to: '/admin/routes', label: 'Manage zones' }}
      title={editing ? 'Edit zone' : 'New zone'}
      sub="A zone is the grid inside 4 corners. Patrollers comb every side street and the major industrial and commercial buildings inside it."
    />
  );

  if (loading || loadError) {
    return (
      <Screen nav>
        {header}
        {loadError ? <LoadError message={loadError} onRetry={() => setReload((n) => n + 1)} /> : <div className="skeleton h-64" aria-busy="true" />}
      </Screen>
    );
  }

  return (
    <Screen nav>
      {header}

      <form onSubmit={onSubmit} noValidate>
        {formError && (
          <div role="alert" className="rounded-[14px] border border-acc bg-accs px-4 py-3 text-sm font-bold text-acc">
            {formError}
          </div>
        )}

        <TextField label="Code" required error={errors.code}
          hint="Unique in your organisation, retired zones included. Letters, numbers, spaces and hyphens; saved in capitals."
          inputRef={(el) => { fieldRefs.current.code = el; }}
          value={values.code} onChange={(v) => set('code', v)} placeholder="CON-01" autoCapitalize="characters" />

        <TextField label="Name" required error={errors.name} hint={`Without the code. ${values.name.trim().length}/${CAPS.name}`}
          inputRef={(el) => { fieldRefs.current.name = el; }}
          value={values.name} onChange={(v) => set('name', v)} placeholder="Concord, Dufferin to Keele" />

        <TextField label="Area type" required error={errors.area_type} hint="Free text, e.g. Industrial, Commercial or Mixed."
          inputRef={(el) => { fieldRefs.current.area_type = el; }} list={listId}
          value={values.area_type} onChange={(v) => set('area_type', v)} placeholder="Mixed" />
        <datalist id={listId}>{AREA_TYPE_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>

        <fieldset className="mt-5 border-0 p-0 m-0">
          <legend className="field-label">Corners <span>({MIN_CORNERS} to {MAX_CORNERS}, in order around the edge)</span></legend>
          {errors.corners && <div role="alert" className="field-err">{errors.corners}</div>}
          <ol className="list-none p-0 m-0 grid gap-3">
            {values.corners.map((c, i) => (
              <CornerRow
                key={i}
                n={i + 1}
                corner={c}
                error={errors.cornerRows?.[i]}
                onChange={(patch) => setCorner(i, patch)}
                onUp={i > 0 ? () => moveCorner(i, -1) : undefined}
                onDown={i < values.corners.length - 1 ? () => moveCorner(i, 1) : undefined}
                onRemove={values.corners.length > MIN_CORNERS ? () => set('corners', values.corners.filter((_, k) => k !== i)) : undefined}
              />
            ))}
          </ol>
          {values.corners.length < MAX_CORNERS && (
            <button type="button" className="btn btn-full mt-3" onClick={() => set('corners', [...values.corners, { label: '', gps: '' }])}>
              <Plus aria-hidden />Add corner
            </button>
          )}
        </fieldset>

        <div className="card mt-4" aria-live="polite">
          <b className="block">Zone map</b>
          {mapUrl ? (
            <>
              <p className="m-0 mt-1">{loopLabel(preview.length)}</p>
              <a className="btn btn-pri btn-full mt-3" href={mapUrl} target="_blank" rel="noopener noreferrer">
                <MapIcon aria-hidden />Open zone map
              </a>
              <p className="field-hint">{ZONE_MAP_NOTE}</p>
            </>
          ) : (
            <p className="m-0 mt-1 text-mut">Fill in every corner to preview the map link.</p>
          )}
          {warnings.length > 0 && (
            <ul className="list-none p-0 m-0 mt-3 grid gap-2">
              {warnings.map((w) => (
                <li key={w} className="flex gap-2 items-start font-bold"><AlertTriangle className="w-5 h-5 flex-none text-acc mt-0.5" aria-hidden />{w}</li>
              ))}
            </ul>
          )}
        </div>

        <fieldset className="mt-5 border-0 p-0 m-0">
          <legend className="field-label">Anchors <span>(optional: major buildings to check)</span></legend>
          {errors.anchors && <div role="alert" className="field-err">{errors.anchors}</div>}
          <ul className="list-none p-0 m-0 grid gap-3">
            {values.anchors.map((a, i) => (
              <li key={i} className="card !p-3">
                <div className="grid gap-2">
                  <input className="input" aria-label={`Anchor ${i + 1} name`} placeholder="Name" value={a.name}
                    onChange={(e) => setAnchor(i, { name: e.target.value })} autoComplete="off" />
                  <input className="input" aria-label={`Anchor ${i + 1} address`} placeholder="Address (optional)" value={a.address}
                    onChange={(e) => setAnchor(i, { address: e.target.value })} autoComplete="off" />
                </div>
                {errors.anchorRows?.[i] && <div role="alert" className="field-err">{errors.anchorRows[i]}</div>}
                <button type="button" className="btn btn-sm btn-dt btn-full mt-2" onClick={() => set('anchors', values.anchors.filter((_, k) => k !== i))}>
                  <Trash2 aria-hidden />Remove anchor
                </button>
              </li>
            ))}
          </ul>
          {values.anchors.length < CAPS.anchors && (
            <button type="button" className="btn btn-full mt-3" onClick={() => set('anchors', [...values.anchors, { name: '', address: '' }])}>
              <Plus aria-hidden />Add anchor
            </button>
          )}
        </fieldset>

        <TextField label="Focus" error={errors.focus} multiline
          inputRef={(el) => { fieldRefs.current.focus = el; }}
          value={values.focus} onChange={(v) => set('focus', v)} placeholder="Faded pylon panels and dark channel letters" />

        <TextField label="Estimated minutes" error={errors.est_minutes} hint="Shown to patrollers as “About N min”."
          inputRef={(el) => { fieldRefs.current.est_minutes = el; }} inputMode="numeric"
          value={values.est_minutes} onChange={(v) => set('est_minutes', v)} placeholder="90" />

        <div className="flex gap-2.5 mt-6">
          <button type="button" className="btn flex-1" onClick={() => navigate('/admin/routes')} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-pri flex-[2]" disabled={submitting}>
            {submitting ? <><span className="spin" aria-hidden />Saving…</> : editing ? 'Save zone' : 'Create zone'}
          </button>
        </div>
      </form>
    </Screen>
  );
};

/** One corner: intersection text, GPS paste field, its own Open in Maps, move and remove. */
const CornerRow: React.FC<{
  n: number;
  corner: CornerDraft;
  error?: string;
  onChange: (patch: Partial<CornerDraft>) => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove?: () => void;
}> = ({ n, corner, error, onChange, onUp, onDown, onRemove }) => {
  const id = useId();
  const gps = corner.gps.trim() ? parseGps(corner.gps) : null;
  const url = corner.label.trim() ? cornerMapsUrl(gps && !('error' in gps) ? { label: corner.label, ...gps } : { label: corner.label }) : null;
  return (
    <li className="card !p-3">
      <div className="flex items-center gap-2">
        <span aria-hidden className="flex-none w-8 h-8 rounded-full bg-sf2 grid place-items-center font-extrabold">{n}</span>
        <label htmlFor={`${id}-label`} className="font-bold">Corner {n}</label>
        <span className="ml-auto flex gap-1.5">
          <button type="button" className="btn btn-sm w-12 px-0" onClick={onUp} disabled={!onUp} aria-label={`Move corner ${n} up`}><ArrowUp aria-hidden /></button>
          <button type="button" className="btn btn-sm w-12 px-0" onClick={onDown} disabled={!onDown} aria-label={`Move corner ${n} down`}><ArrowDown aria-hidden /></button>
          <button type="button" className="btn btn-sm btn-dt w-12 px-0" onClick={onRemove} disabled={!onRemove} aria-label={`Remove corner ${n}`}><Trash2 aria-hidden /></button>
        </span>
      </div>
      <input id={`${id}-label`} className={`input mt-2 ${error ? 'input-bad' : ''}`} value={corner.label}
        onChange={(e) => onChange({ label: e.target.value })} placeholder="Dufferin & Steeles, Concord ON" autoComplete="off"
        aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} />
      <input className={`input mt-2 ${gps && 'error' in gps ? 'input-bad' : ''}`} value={corner.gps} inputMode="decimal"
        onChange={(e) => onChange({ gps: e.target.value })} placeholder="GPS: paste lat,lng (optional)" autoComplete="off"
        aria-label={`Corner ${n} GPS, lat,lng`} />
      {error && <div id={`${id}-err`} role="alert" className="field-err">{error}</div>}
      {url && (
        <a className="btn btn-sm btn-full mt-2" href={url} target="_blank" rel="noopener noreferrer"><MapPin aria-hidden />Open in Maps</a>
      )}
    </li>
  );
};

/** Label above the control, then the error (announced) or the hint below it. */
const TextField: React.FC<{
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  list?: string;
  inputMode?: 'numeric' | 'decimal';
  autoCapitalize?: string;
  inputRef: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
}> = ({ label, required = false, error, hint, value, onChange, placeholder, multiline, list, inputMode, autoCapitalize, inputRef }) => {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  const common = {
    id, value, placeholder, autoComplete: 'off', 'aria-invalid': !!error, 'aria-describedby': describedBy,
    className: `input ${error ? 'input-bad' : ''}`,
  };
  return (
    <div className="mt-4">
      <label htmlFor={id} className="field-label">
        {label}
        {required ? <span className="sr-only"> (required)</span> : <span> (optional)</span>}
      </label>
      {multiline
        ? <textarea {...common} ref={inputRef} onChange={(e) => onChange(e.target.value)} />
        : <input {...common} ref={inputRef} list={list} inputMode={inputMode} autoCapitalize={autoCapitalize} onChange={(e) => onChange(e.target.value)} />}
      {error && <div id={errorId} role="alert" className="field-err">{error}</div>}
      {hint && <div id={hintId} className="field-hint">{hint}</div>}
    </div>
  );
};

export default ZoneFormPage;

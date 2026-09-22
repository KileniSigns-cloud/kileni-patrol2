import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import { DuplicateCodeError } from '../lib/routesApi';
import {
  AREA_TYPES, EMPTY_ROUTE_FORM, NAME_MAX, addHotspot, validateRouteForm,
  type RouteFormErrors, type RouteFormValues,
} from '../lib/routeForm';
import AdminHeader from '../components/admin/AdminHeader';
import { toast } from '../components/ui/Toast';

const focusRing = 'active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FCCA3B]';
const inputBase = 'w-full min-h-12 px-4 py-3 rounded-xl bg-[#1C1C1E] border text-base text-white placeholder-[#8F8F8F] outline-none transition-colors focus:border-[#FCCA3B]';
const inputCls = (hasError: boolean) => `${inputBase} ${hasError ? 'border-red-500' : 'border-[#2A2A2A]'}`;

const CreateRouteFormPage: React.FC = () => {
  const navigate = useNavigate();
  const createRoute = usePatrolStore((s) => s.createRoute);
  const [values, setValues] = useState<RouteFormValues>(EMPTY_ROUTE_FORM);
  const [errors, setErrors] = useState<RouteFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [hotspotDraft, setHotspotDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fieldRefs = useRef<Partial<Record<keyof RouteFormValues, HTMLElement | null>>>({});

  const set = <K extends keyof RouteFormValues>(key: K, value: RouteFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const commitHotspot = () => {
    set('hotspots', addHotspot(values.hotspots, hotspotDraft));
    setHotspotDraft('');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    // A hotspot typed but not added yet is almost certainly meant to be included.
    const final = hotspotDraft.trim() ? { ...values, hotspots: addHotspot(values.hotspots, hotspotDraft) } : values;
    const found = validateRouteForm(final);
    setErrors(found);
    const firstBad = (Object.keys(found) as (keyof RouteFormValues)[])[0];
    if (firstBad) {
      fieldRefs.current[firstBad]?.focus();
      return;
    }

    setSubmitting(true);
    try {
      const route = await createRoute(final);
      toast.success(`Route "${route.name}" created.`);
      navigate('/admin/routes', { replace: true });
    } catch (err) {
      if (err instanceof DuplicateCodeError) {
        setErrors({ code: err.message });
        fieldRefs.current.code?.focus();
      } else {
        setFormError(err instanceof Error ? err.message : 'Could not create route.');
      }
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] pb-12">
      <div className="max-w-xl mx-auto">
        <AdminHeader eyebrow="Admin · Routes" title="Create route" backTo="/admin/routes" />

        <form onSubmit={onSubmit} noValidate className="px-4 sm:px-6 flex flex-col gap-5">
          {formError && (
            <div role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {formError}
            </div>
          )}

          <Field label="Name" required error={errors.name} hint={`${values.name.trim().length}/${NAME_MAX}`}>
            {(id, describedBy) => (
              <input
                id={id}
                ref={(el) => { fieldRefs.current.name = el; }}
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
                maxLength={NAME_MAX + 20}
                autoComplete="off"
                aria-invalid={!!errors.name}
                aria-describedby={describedBy}
                placeholder="e.g. Downtown Core"
                className={inputCls(!!errors.name)}
              />
            )}
          </Field>

          <Field label="Code" required error={errors.code} hint="Short unique code, e.g. DT-01. No spaces.">
            {(id, describedBy) => (
              <input
                id={id}
                ref={(el) => { fieldRefs.current.code = el; }}
                value={values.code}
                onChange={(e) => set('code', e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                aria-invalid={!!errors.code}
                aria-describedby={describedBy}
                placeholder="DT-01"
                className={`${inputCls(!!errors.code)} font-mono`}
              />
            )}
          </Field>

          <Field label="Description" error={errors.description}>
            {(id, describedBy) => (
              <textarea
                id={id}
                rows={3}
                value={values.description}
                onChange={(e) => set('description', e.target.value)}
                aria-describedby={describedBy}
                className={`${inputCls(false)} resize-y`}
              />
            )}
          </Field>

          <Field label="Area type" error={errors.area_type}>
            {(id, describedBy) => (
              <select
                id={id}
                ref={(el) => { fieldRefs.current.area_type = el; }}
                value={values.area_type}
                onChange={(e) => set('area_type', e.target.value as RouteFormValues['area_type'])}
                aria-invalid={!!errors.area_type}
                aria-describedby={describedBy}
                className={`${inputCls(!!errors.area_type)} appearance-none capitalize`}
              >
                <option value="">Not set</option>
                {AREA_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
            )}
          </Field>

          <Field label="Focus" hint="Priority for patrollers on this route.">
            {(id, describedBy) => (
              <input
                id={id}
                value={values.focus}
                onChange={(e) => set('focus', e.target.value)}
                aria-describedby={describedBy}
                placeholder="e.g. Plazas along Main St"
                className={inputCls(false)}
              />
            )}
          </Field>

          <Field label="Start point" hint="Address where the patrol begins.">
            {(id, describedBy) => (
              <input
                id={id}
                value={values.start_point}
                onChange={(e) => set('start_point', e.target.value)}
                aria-describedby={describedBy}
                autoComplete="street-address"
                className={inputCls(false)}
              />
            )}
          </Field>

          <Field label="Hotspots" hint="Add each hotspot, then tap Add or press Enter.">
            {(id, describedBy) => (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <input
                    id={id}
                    value={hotspotDraft}
                    onChange={(e) => setHotspotDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitHotspot(); } }}
                    aria-describedby={describedBy}
                    placeholder="e.g. Yonge & Bloor"
                    className={inputCls(false)}
                  />
                  <button
                    type="button"
                    onClick={commitHotspot}
                    disabled={!hotspotDraft.trim()}
                    className={`min-h-12 px-4 flex-shrink-0 inline-flex items-center gap-1 rounded-xl border border-[#2A2A2A] text-white font-semibold disabled:opacity-40 hover:border-[#8F8F8F] transition-colors ${focusRing}`}
                  >
                    <Plus className="w-4 h-4" aria-hidden /> Add
                  </button>
                </div>
                {values.hotspots.length > 0 && (
                  <ul className="flex flex-wrap gap-2" aria-label="Hotspots added">
                    {values.hotspots.map((h) => (
                      <li key={h} className="inline-flex items-center gap-1 pl-3 rounded-full border border-[#2A2A2A] bg-[#1C1C1E] text-sm text-white">
                        {h}
                        <button
                          type="button"
                          onClick={() => set('hotspots', values.hotspots.filter((x) => x !== h))}
                          aria-label={`Remove hotspot ${h}`}
                          className={`w-12 h-12 inline-flex items-center justify-center rounded-full text-[#8F8F8F] hover:text-white ${focusRing}`}
                        >
                          <X className="w-4 h-4" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate('/admin/routes')}
              disabled={submitting}
              className={`min-h-12 px-5 rounded-xl border border-[#2A2A2A] text-white font-semibold hover:border-[#8F8F8F] disabled:opacity-50 transition-colors sm:flex-1 ${focusRing}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`min-h-12 px-5 rounded-xl bg-[#FCCA3B] text-black font-black hover:brightness-110 disabled:opacity-60 transition sm:flex-[2] ${focusRing}`}
            >
              {submitting ? 'Creating…' : 'Create route'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/** Label above the control, hint below, and the error (red, announced) under that. */
const Field: React.FC<{
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: (id: string, describedBy: string | undefined) => React.ReactNode;
}> = ({ label, required = false, error, hint, children }) => {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-white">
        {label}
        {required ? <span className="text-red-400" aria-hidden> *</span> : <span className="text-[#8F8F8F] font-normal"> (optional)</span>}
      </label>
      {children(id, describedBy)}
      {hint && <p id={hintId} className="text-xs text-[#8F8F8F]">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
};

export default CreateRouteFormPage;

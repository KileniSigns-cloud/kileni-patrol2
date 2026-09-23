import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { usePatrolStore } from '../store/patrol.store';
import { DuplicateCodeError } from '../lib/routesApi';
import {
  AREA_TYPES, EMPTY_ROUTE_FORM, NAME_MAX, addHotspot, validateRouteForm,
  type RouteFormErrors, type RouteFormValues,
} from '../lib/routeForm';
import { errorMessage } from '../lib/errors';
import Screen from '../components/layout/Screen';
import AdminHeader from '../components/admin/AdminHeader';
import { toast } from '../components/ui/Toast';

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
      toast.success(`Created ${route.name}`);
      navigate('/admin/routes', { replace: true });
    } catch (err) {
      if (err instanceof DuplicateCodeError) {
        setErrors({ code: err.message });
        fieldRefs.current.code?.focus();
      } else {
        setFormError(errorMessage(err, 'Could not create route.'));
      }
      setSubmitting(false);
    }
  };

  return (
    <Screen nav>
      <AdminHeader
        back={{ to: '/admin/routes', label: 'Manage routes' }}
        title="New route"
        sub="Name and code are required. Everything else helps patrollers on the ground."
      />

      <form onSubmit={onSubmit} noValidate>
        {formError && (
          <div role="alert" className="rounded-[14px] border border-acc bg-accs px-4 py-3 text-sm font-bold text-acc">
            {formError}
          </div>
        )}

        <Field label="Name" required error={errors.name} hint={`${values.name.trim().length}/${NAME_MAX}`}>
          {(id, describedBy) => (
            <input
              id={id}
              ref={(el) => { fieldRefs.current.name = el; }}
              className={`input ${errors.name ? 'input-bad' : ''}`}
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={NAME_MAX + 20}
              autoComplete="off"
              aria-invalid={!!errors.name}
              aria-describedby={describedBy}
              placeholder="Downtown Core"
            />
          )}
        </Field>

        <Field label="Code" required error={errors.code} hint="Unique in your company, archived routes included. Not case-sensitive. No spaces.">
          {(id, describedBy) => (
            <input
              id={id}
              ref={(el) => { fieldRefs.current.code = el; }}
              className={`input ${errors.code ? 'input-bad' : ''}`}
              value={values.code}
              onChange={(e) => set('code', e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              aria-invalid={!!errors.code}
              aria-describedby={describedBy}
              placeholder="DT-01"
            />
          )}
        </Field>

        <Field label="Description" error={errors.description}>
          {(id, describedBy) => (
            <textarea
              id={id}
              className="input"
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              aria-describedby={describedBy}
              placeholder="Streets and limits this loop covers"
            />
          )}
        </Field>

        <Field label="Area type" error={errors.area_type}>
          {(id, describedBy) => (
            <select
              id={id}
              ref={(el) => { fieldRefs.current.area_type = el; }}
              className={`input ${errors.area_type ? 'input-bad' : ''}`}
              value={values.area_type}
              onChange={(e) => set('area_type', e.target.value as RouteFormValues['area_type'])}
              aria-invalid={!!errors.area_type}
              aria-describedby={describedBy}
            >
              <option value="">Not set</option>
              {AREA_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
          )}
        </Field>

        <Field label="Start point">
          {(id, describedBy) => (
            <input
              id={id}
              className="input"
              value={values.start_point}
              onChange={(e) => set('start_point', e.target.value)}
              aria-describedby={describedBy}
              autoComplete="street-address"
              placeholder="Yonge & Queen"
            />
          )}
        </Field>

        <Field label="Focus">
          {(id, describedBy) => (
            <input
              id={id}
              className="input"
              value={values.focus}
              onChange={(e) => set('focus', e.target.value)}
              aria-describedby={describedBy}
              placeholder="Illuminated storefronts"
            />
          )}
        </Field>

        <Field label="Hotspots" hint="Add each hotspot, then tap + or press Enter.">
          {(id, describedBy) => (
            <>
              <div className="flex gap-2">
                <input
                  id={id}
                  className="input flex-1"
                  value={hotspotDraft}
                  onChange={(e) => setHotspotDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitHotspot(); } }}
                  aria-describedby={describedBy}
                  placeholder="Intersection or plaza"
                />
                <button type="button" className="btn w-[52px] px-0" onClick={commitHotspot} disabled={!hotspotDraft.trim()} aria-label="Add hotspot">
                  <Plus aria-hidden />
                </button>
              </div>
              {values.hotspots.length > 0 && (
                <ul className="flex flex-wrap gap-2 mt-2.5 list-none p-0" aria-label="Hotspots added">
                  {values.hotspots.map((h) => (
                    <li key={h} className="chip">
                      {h}
                      <button type="button" onClick={() => set('hotspots', values.hotspots.filter((x) => x !== h))} aria-label={`Remove ${h}`}>
                        <X aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Field>

        <div className="flex gap-2.5 mt-6">
          <button type="button" className="btn flex-1" onClick={() => navigate('/admin/routes')} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-pri flex-[2]" disabled={submitting}>
            {submitting ? <><span className="spin" aria-hidden />Creating…</> : 'Create route'}
          </button>
        </div>
      </form>
    </Screen>
  );
};

/** Label above the control, then the error (announced) or the hint below it. */
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
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {required ? <span className="sr-only"> (required)</span> : <span> (optional)</span>}
      </label>
      {children(id, describedBy)}
      {error && <div id={errorId} role="alert" className="field-err">{error}</div>}
      {hint && <div id={hintId} className="field-hint">{hint}</div>}
    </div>
  );
};

export default CreateRouteFormPage;

import { useId, useState } from 'react';
import { ChevronDown, MapPin } from 'lucide-react';
import { hotspotList, mapsUrl, splitStepNote, stepLabels, type RouteInfoData } from '../../lib/routeInfo';

interface RouteInfoProps {
  route: RouteInfoData;
  /** Bigger type for the Route info sheet (read at arm's length, often at night). */
  large?: boolean;
  /** The route preview shows the description; the sheet leaves it out to stay short. */
  showDescription?: boolean;
  titleAs?: 'h1' | 'h2' | 'h3';
}

const label = 'block text-mut text-[13px] font-bold';

/**
 * Route name and code, area type, start point (with Open in Maps), focus, hotspots and the
 * turn-by-turn directions, collapsed until tapped. Read-only. Every value is rendered as text.
 * Sections with nothing in them are left out entirely.
 */
const RouteInfo: React.FC<RouteInfoProps> = ({ route, large = false, showDescription = false, titleAs: Title = 'h2' }) => {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const steps = stepLabels(route.steps);
  const hotspots = hotspotList(route.hotspots);
  const maps = mapsUrl(route.start_point);

  return (
    <section className={large ? 'text-[18px] leading-normal' : undefined} aria-label="Route info">
      {route.code && <span className="badge">{route.code}</span>}
      <Title className={Title === 'h1' ? undefined : 'mt-1.5 mb-1 text-xl font-extrabold'}>{route.name}</Title>
      {showDescription && route.description && <p className="sub whitespace-pre-line">{route.description}</p>}
      {route.area_type && <p className="text-mut mt-0 mb-3">{route.area_type}</p>}

      {route.start_point && (
        <div className="card mt-3">
          <small className={label}>Start point</small>
          <p className="m-0 mt-1 font-bold">{route.start_point}</p>
          {maps && (
            <a className="btn btn-full mt-3" href={maps} target="_blank" rel="noopener noreferrer">
              <MapPin aria-hidden />Open in Maps
            </a>
          )}
        </div>
      )}

      {route.focus && (
        <div className="mt-4">
          <small className={label}>Focus</small>
          <p className="m-0 mt-1 whitespace-pre-line">{route.focus}</p>
        </div>
      )}

      {hotspots.length > 0 && (
        <div className="mt-4">
          <small className={label}>Hotspots</small>
          <ul className="list-none p-0 m-0 mt-2 flex flex-wrap gap-2">
            {hotspots.map((h, i) => <li key={`${h}-${i}`} className="chip pr-3">{h}</li>)}
          </ul>
        </div>
      )}

      {steps.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            className="btn btn-full justify-between"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
          >
            <span>Directions</span>
            <span className="flex items-center gap-1 text-mut">
              {steps.length} {steps.length === 1 ? 'step' : 'steps'}
              <ChevronDown aria-hidden className={open ? 'rotate-180' : undefined} />
            </span>
          </button>
          {open && <StepList id={listId} steps={steps} />}
        </div>
      )}
    </section>
  );
};

/** Numbered steps as plain text; a trailing "(note)" becomes a lighter second line. */
export const StepList: React.FC<{ id?: string; steps: readonly string[] }> = ({ id, steps }) => (
  <ol id={id} className="list-none p-0 m-0 mt-2 grid gap-2">
    {steps.map((s, i) => {
      const { text, note } = splitStepNote(s);
      return (
        <li key={i} className="flex gap-3 items-start bg-sf border border-line rounded-[14px] px-3.5 py-3">
          <span aria-hidden className="flex-none w-7 h-7 rounded-full bg-sf2 grid place-items-center font-extrabold text-[14px]">{i + 1}</span>
          <span className="min-w-0">
            <span className="block">{text}</span>
            {note && <span className="block text-mut text-[0.9em] mt-0.5">{note}</span>}
          </span>
        </li>
      );
    })}
  </ol>
);

export default RouteInfo;

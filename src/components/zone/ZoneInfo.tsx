import { Map as MapIcon, MapPin } from 'lucide-react';
import {
  anchorList, cornerList, cornerMapsUrl, estLabel, hasGps, loopLabel, zoneMapUrl, type ZoneInfoData,
} from '../../lib/zoneInfo';

interface ZoneInfoProps {
  zone: ZoneInfoData;
  /** Bigger type for the Zone info sheet (read at arm's length, often at night, with gloves). */
  large?: boolean;
  titleAs?: 'h1' | 'h2' | 'h3';
}

/** Shown beside every "Open zone map": the link is for seeing the loop, not for driving it. */
export const ZONE_MAP_NOTE = "Preview only. Don't press Start in Maps. Drive the edges and turn into side streets.";

// Labels and content all use --tx (14.9:1 light, 14.6:1 dark): --mut is under 7:1 in light mode.
const label = 'block text-tx text-[15px] font-extrabold uppercase tracking-wide';

/**
 * Zone code and name, area type, estimate, Open zone map (one Google Maps loop through the
 * corners), the corners in perimeter order each with its own Open in Maps, anchors and focus.
 * Read-only. Every value is rendered as text; links are built by zoneInfo.ts from fixed
 * https://www.google.com/maps/ prefixes with encoded values. Empty sections are left out.
 */
const ZoneInfo: React.FC<ZoneInfoProps> = ({ zone, large = false, titleAs: Title = 'h2' }) => {
  const corners = cornerList(zone.corners);
  const anchors = anchorList(zone.anchors);
  const mapUrl = zoneMapUrl(corners);
  const est = estLabel(zone.est_minutes);

  return (
    <section className={`text-tx ${large ? 'text-[19px] leading-snug' : ''}`} aria-label="Zone info">
      {zone.code && <span className="badge !text-tx">{zone.code}</span>}
      <Title className={Title === 'h1' ? undefined : 'mt-1.5 mb-1 text-[22px] font-extrabold'}>{zone.name}</Title>
      {(zone.area_type || est) && (
        <p className="m-0 mt-1 font-bold">
          {zone.area_type}
          {zone.area_type && est && ' · '}
          {est}
        </p>
      )}

      {mapUrl && (
        <div className="mt-4">
          <a className="btn btn-pri btn-xl btn-full" href={mapUrl} target="_blank" rel="noopener noreferrer">
            <MapIcon aria-hidden />Open zone map
          </a>
          <p className="m-0 mt-2 font-bold">{ZONE_MAP_NOTE}</p>
          <p className="m-0 mt-1">{loopLabel(corners.length)}</p>
        </div>
      )}

      {corners.length > 0 && (
        <div className="mt-5">
          <h4 className={label}>Corners</h4>
          <ol className="list-none p-0 m-0 mt-2 grid gap-3">
            {corners.map((c, i) => {
              const url = cornerMapsUrl(c);
              return (
                <li key={i} className="bg-sf border-2 border-line rounded-[14px] px-3.5 py-3">
                  <div className="flex gap-3 items-start">
                    <span aria-hidden className="flex-none w-9 h-9 rounded-full bg-sf2 grid place-items-center font-extrabold text-[18px]">{i + 1}</span>
                    <span className="min-w-0 pt-1">
                      <span className="sr-only">Corner {i + 1}: </span>
                      <span className="block text-[20px] font-extrabold leading-tight">{c.label}</span>
                      {!hasGps(c) && <span className="block text-[15px] mt-0.5">No GPS: Maps searches the name</span>}
                    </span>
                  </div>
                  {url && (
                    <a className="btn btn-lg btn-full mt-3" href={url} target="_blank" rel="noopener noreferrer"
                      aria-label={`Open corner ${i + 1}, ${c.label}, in Maps`}>
                      <MapPin aria-hidden />Open in Maps
                    </a>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {anchors.length > 0 && (
        <div className="mt-5">
          <h4 className={label}>Anchors</h4>
          <ul className="list-none p-0 m-0 mt-2 grid gap-2">
            {anchors.map((a, i) => (
              <li key={`${a.name}-${i}`} className="bg-sf border-2 border-line rounded-[14px] px-3.5 py-2.5">
                <span className="block font-extrabold">{a.name}</span>
                {a.address && <span className="block">{a.address}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {zone.focus && (
        <div className="mt-5">
          <h4 className={label}>Focus</h4>
          <p className="m-0 mt-1 whitespace-pre-line">{zone.focus}</p>
        </div>
      )}
    </section>
  );
};

export default ZoneInfo;

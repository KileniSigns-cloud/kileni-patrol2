// What the admin sees when deleting a route. The rule itself is enforced in the DB by
// delete_route_if_unused (migration 010); this only turns its answer into dialog text.

import { plural } from './patrolHistory.ts';

export interface RouteDeleteCheck {
  status: 'deletable' | 'deleted' | 'in_use';
  sessions: number;
  businesses: number;
  signs: number;
}

export interface RouteDeleteDialog {
  title: string;
  message: string;
  /** delete: hard delete allowed. archive: in use and active. none: in use and already archived. */
  action: 'delete' | 'archive' | 'none';
}

/** "31 patrols, 3 businesses and 5 sign records" (zero counts left out). */
export function describeRouteUse(c: Pick<RouteDeleteCheck, 'sessions' | 'businesses' | 'signs'>): string {
  const parts = [
    c.sessions > 0 ? `${c.sessions} ${plural('patrol', c.sessions)}` : null,
    c.businesses > 0 ? `${c.businesses} ${plural('business', c.businesses, 'businesses')}` : null,
    c.signs > 0 ? `${c.signs} ${plural('sign record', c.signs)}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function routeDeleteDialog(
  route: { code: string | null; name: string; archived_at: string | null },
  check: RouteDeleteCheck,
): RouteDeleteDialog {
  const label = route.code || route.name;
  if (check.status !== 'in_use') {
    return {
      title: `Delete ${label}?`,
      message: 'No patrols, businesses or sign records use this route. Deleting it removes it for good and can\'t be undone.',
      action: 'delete',
    };
  }
  const why = `${label} has ${describeRouteUse(check)}, so it can't be deleted: deleting it would delete that history too.`;
  return route.archived_at
    ? { title: `${label} can't be deleted`, message: `${why} It's already archived, so patrollers don't see it and its history stays viewable.`, action: 'none' }
    : { title: `${label} can't be deleted`, message: `${why} Archive it instead: patrollers stop seeing it, its history stays, and you can restore it anytime.`, action: 'archive' };
}

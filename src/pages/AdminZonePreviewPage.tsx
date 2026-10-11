import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { usePatrolStore } from '../store/patrol.store';
import type { PatrolRoute } from '../types';
import { errorMessage } from '../lib/errors';
import Screen from '../components/layout/Screen';
import AdminHeader from '../components/admin/AdminHeader';
import { LoadError } from '../components/ui/EmptyState';
import AdminZonePreview from '../components/zone/AdminZonePreview';

/** Admin-only zone preview (/admin/routes/:routeId/preview): Zone info, no Start patrol. */
const AdminZonePreviewPage: React.FC = () => {
  const { routeId } = useParams<{ routeId: string }>();
  const getZone = usePatrolStore((s) => s.getZone);
  const [zone, setZone] = useState<PatrolRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!routeId) return;
    let live = true;
    setError(null);
    getZone(routeId)
      .then((z) => { if (live) setZone(z); })
      .catch((e) => { if (live) setError(errorMessage(e, 'Could not load the zone.')); });
    return () => { live = false; };
  }, [routeId, getZone, reload]);

  if (zone && routeId) return <AdminZonePreview zone={zone} routeId={routeId} />;

  return (
    <Screen nav>
      <AdminHeader back={{ to: '/admin/routes', label: 'Manage zones' }} title="Zone preview" />
      {error ? <LoadError message={error} onRetry={() => setReload((n) => n + 1)} /> : <div className="skeleton h-64" aria-busy="true" />}
    </Screen>
  );
};

export default AdminZonePreviewPage;

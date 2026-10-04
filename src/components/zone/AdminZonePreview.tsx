import { useNavigate } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import type { ZoneInfoData } from '../../lib/zoneInfo';
import Screen from '../layout/Screen';
import AdminHeader from '../admin/AdminHeader';
import ZoneInfo from './ZoneInfo';

/**
 * What an admin sees from Manage zones > Preview: the same Zone info patrollers get (Open zone
 * map, corners, anchors, focus), with Edit, and deliberately no Start patrol. Patrols are only
 * started from the Zones tab (RoutePreviewPage), so previewing never creates patrol history.
 */
const AdminZonePreview: React.FC<{ zone: ZoneInfoData; routeId: string }> = ({ zone, routeId }) => {
  const navigate = useNavigate();
  return (
    <Screen nav>
      <AdminHeader
        back={{ to: '/admin/routes', label: 'Manage zones' }}
        title="Zone preview"
        sub="What patrollers see in Zone info. Patrols are started from the Zones tab."
        action={
          <button className="btn btn-sm flex-none" onClick={() => navigate(`/admin/routes/${routeId}/edit`)}>
            <Pencil aria-hidden />Edit
          </button>
        }
      />
      <ZoneInfo zone={zone} titleAs="h2" />
    </Screen>
  );
};

export default AdminZonePreview;

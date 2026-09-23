import { useNavigate } from 'react-router-dom';
import { Footprints } from 'lucide-react';
import Screen from '../layout/Screen';
import EmptyState from '../ui/EmptyState';

/** Shown on a flow screen reached without a loaded patrol (e.g. after a refresh). */
const NoSession: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Screen nav>
      <div className="mt-6">
        <EmptyState
          icon={Footprints}
          title="No patrol loaded"
          body="This screen belongs to a patrol that isn't open on this device. Resume it from the Patrol tab."
          action={{ label: 'Go to Patrol', onClick: () => navigate('/patrol', { replace: true }) }}
        />
      </div>
    </Screen>
  );
};

export default NoSession;

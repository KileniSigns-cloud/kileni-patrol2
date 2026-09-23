import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { usePatrolSession } from '../context/PatrolSessionContext';
import Screen from '../components/layout/Screen';
import StepProgress from '../components/flow/StepProgress';
import FlowFooter, { FooterRow } from '../components/flow/FlowFooter';
import NoSession from '../components/flow/NoSession';

const PATROL_OPTIONS = [
  { type: 'day' as const, Icon: Sun, title: 'Day', subtitle: 'Faces, structure and graphics in daylight' },
  { type: 'night' as const, Icon: Moon, title: 'Night', subtitle: 'Lighting check: outages and partly lit signs' },
];

// Short pause so the selected tile is visible before the next step.
const ADVANCE_MS = 200;

const PatrolTypePage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessionId: activeSessionId, patrolType, setPatrolType } = usePatrolSession();

  const [selected, setSelected] = useState<'day' | 'night' | null>(patrolType);

  if (!activeSessionId) return <NoSession />;

  const next = () => navigate(`/sign-type/${sessionId}`);

  const handleSelect = (type: 'day' | 'night') => {
    setSelected(type);
    setPatrolType(type);
    setTimeout(next, ADVANCE_MS);
  };

  return (
    <Screen
      footer={
        <FlowFooter hint={selected ? null : 'Pick a patrol type to continue.'}>
          <FooterRow>
            <button className="btn" onClick={() => navigate(`/photos/${sessionId}`)}>Back</button>
            <button className="btn btn-pri" onClick={next} disabled={!selected}>Next: sign type</button>
          </FooterRow>
        </FlowFooter>
      }
    >
      <StepProgress step={2} />
      <h1>Patrol type</h1>
      <p className="sub">How are you seeing this sign?</p>
      <div className="grid gap-2.5">
        {PATROL_OPTIONS.map(({ type, Icon, title, subtitle }) => (
          <button key={type} className="tile" aria-pressed={selected === type} onClick={() => handleSelect(type)}>
            <span className="icon-tile"><Icon aria-hidden /></span>
            <span><b>{title}</b><small>{subtitle}</small></span>
          </button>
        ))}
      </div>
    </Screen>
  );
};

export default PatrolTypePage;

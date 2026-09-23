import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AppWindow, Landmark, LayoutPanelTop, Milestone, Monitor, RectangleHorizontal, Shapes, Signpost, Sparkles, Square, Type,
  type LucideIcon,
} from 'lucide-react';
import { usePatrolSession } from '../context/PatrolSessionContext';
import { skipsPatrolType } from '../lib/signFlow';
import Screen from '../components/layout/Screen';
import StepProgress from '../components/flow/StepProgress';
import FlowFooter, { FooterRow } from '../components/flow/FlowFooter';
import NoSession from '../components/flow/NoSession';

type Category = 'Illuminated' | 'Non-Illuminated';

const SIGN_TYPES: Record<Category, string[]> = {
  'Illuminated': [
    'Channel Letters',
    'LED Cabinet / Sign Box',
    'Monument Signs',
    'Digital & Electronic Displays',
    'Specialty Illuminated',
    'Other',
  ],
  'Non-Illuminated': [
    'Flat Cut Letters',
    'ACP Panel Signs',
    'Pylon / Pole Signs',
    'Wayfinding / Directional',
    'Window Graphics',
    'Other',
  ],
};

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'Illuminated', label: 'Illuminated' },
  { value: 'Non-Illuminated', label: 'Non illuminated' },
];

const ICONS: Record<string, LucideIcon> = {
  'Channel Letters': Type,
  'LED Cabinet / Sign Box': Square,
  'Monument Signs': Landmark,
  'Digital & Electronic Displays': Monitor,
  'Specialty Illuminated': Sparkles,
  'Flat Cut Letters': Type,
  'ACP Panel Signs': RectangleHorizontal,
  'Pylon / Pole Signs': Milestone,
  'Wayfinding / Directional': Signpost,
  'Window Graphics': AppWindow,
};

const ADVANCE_MS = 200;

const SignTypePage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessionId: activeSessionId, signCategory: ctxSignCategory, signType: ctxSignType, setSignCategory, setSignType, reusingBusiness, patrolType } = usePatrolSession();

  const [category, setCategory] = useState<Category | null>(ctxSignCategory as Category | null);
  const [signType, setSignTypeState] = useState<string | null>(ctxSignType);

  if (!activeSessionId) return <NoSession />;

  const next = () => navigate(`/issues/${sessionId}`);

  const handleCategorySelect = (cat: Category) => {
    setCategory(cat);
    setSignTypeState(null);
    setSignCategory(cat);
  };

  const handleTypeSelect = (type: string) => {
    setSignTypeState(type);
    setSignCategory(category!);
    setSignType(type);
    setTimeout(next, ADVANCE_MS);
  };

  const hint = !category ? 'Pick lighting first.' : !signType ? 'Pick the closest sign type.' : null;

  return (
    <Screen
      footer={
        <FlowFooter hint={hint}>
          <FooterRow>
            <button
              className="btn"
              onClick={() => navigate(skipsPatrolType({ reusingBusiness, patrolType }) ? `/photos/${sessionId}` : `/patrol-type/${sessionId}`)}
            >
              Back
            </button>
            <button className="btn btn-pri" onClick={next} disabled={!category || !signType}>Next: issues</button>
          </FooterRow>
        </FlowFooter>
      }
    >
      <StepProgress step={3} />
      <h1>Sign type</h1>
      <p className="sub">Pick lighting first, then the closest match.</p>

      <div className="seg" role="group" aria-label="Lighting">
        {CATEGORIES.map(({ value, label }) => (
          <button key={value} aria-pressed={category === value} onClick={() => handleCategorySelect(value)}>{label}</button>
        ))}
      </div>

      {category && (
        <div className="grid grid-cols-2 gap-2.5 mt-3">
          {SIGN_TYPES[category].map((type) => {
            const Icon = ICONS[type] ?? (type === 'Other' ? Shapes : LayoutPanelTop);
            return (
              <button key={type} className="tile tile-col" aria-pressed={signType === type} onClick={() => handleTypeSelect(type)}>
                <span className="icon-tile"><Icon aria-hidden /></span>
                <b>{type}</b>
              </button>
            );
          })}
        </div>
      )}
    </Screen>
  );
};

export default SignTypePage;

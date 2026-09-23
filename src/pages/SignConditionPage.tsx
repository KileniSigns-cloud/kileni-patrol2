import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { usePatrolSession } from '../context/PatrolSessionContext';
import Screen from '../components/layout/Screen';
import NoSession from '../components/flow/NoSession';

// Placeholder route (/sign-condition/:sessionId). Not part of the flow: Sign type goes to Issues.
const SignConditionPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { sessionId: activeSessionId } = usePatrolSession();

  if (!activeSessionId) return <NoSession />;

  return (
    <Screen>
      <button className="linkb -ml-1" onClick={() => navigate(`/sign-type/${sessionId}`)}>
        <ChevronLeft aria-hidden />Sign type
      </button>
      <h1>Sign condition</h1>
      <p className="sub">Rate the condition of the sign.</p>
    </Screen>
  );
};

export default SignConditionPage;

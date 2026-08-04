import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { fetchThreads } from '../lib/api';

export function DecisionLanding() {
  const navigate = useNavigate();
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    fetchThreads({ sort: 'recent', limit: 1 })
      .then(({ threads }) => {
        if (threads[0]) navigate(`/threads/${threads[0].id}`, { replace: true });
        else setEmpty(true);
      })
      .catch(() => setEmpty(true));
  }, [navigate]);

  if (!empty) return <div className="panel h-[520px] animate-pulse" aria-label="Loading latest decision" />;
  return (
    <EmptyState
      icon="branch"
      title="Your research map starts here"
      description="Visit a genuine comparison or evaluation page. Trace will create the first decision and bring you back to the exact point where you stopped."
    />
  );
}

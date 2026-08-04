import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Layout } from './components/Layout';

const AllThreads = lazy(() => import('./pages/AllThreads').then((module) => ({ default: module.AllThreads })));
const ThreadView = lazy(() => import('./pages/ThreadView').then((module) => ({ default: module.ThreadView })));
const DecisionLanding = lazy(() => import('./pages/DecisionLanding').then((module) => ({ default: module.DecisionLanding })));

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Suspense fallback={<RouteLoader />}><DecisionLanding /></Suspense>} />
          <Route path="/activity" element={<Navigate to="/" replace />} />
          <Route path="/threads" element={<Navigate to="/decisions" replace />} />
          <Route path="/decisions" element={<Suspense fallback={<RouteLoader />}><AllThreads /></Suspense>} />
          <Route path="/threads/:id" element={<Suspense fallback={<RouteLoader />}><ThreadView /></Suspense>} />
          <Route path="/capture" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function RouteLoader() {
  return <div className="decision-loading" aria-label="Loading"><div /><div /><div /></div>;
}

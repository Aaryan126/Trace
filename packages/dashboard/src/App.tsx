import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { AllThreads } from './pages/AllThreads';
import { ThreadView } from './pages/ThreadView';
import { CaptureView } from './pages/CaptureView';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/threads" element={<AllThreads />} />
          <Route path="/threads/:id" element={<ThreadView />} />
          <Route path="/capture" element={<CaptureView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

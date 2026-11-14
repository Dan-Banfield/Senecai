import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { usePipeline } from './input/pipeline';
import { BenchPage } from './pages/BenchPage';
import { CommunityPage } from './pages/CommunityPage';
import { CreationPage } from './pages/CreationPage';
import { KantelePage } from './pages/KantelePage';
import { PianoPage } from './pages/PianoPage';
import { InputPanel, SourcePill } from './ui/InputPanel';
import { SearchBar } from './ui/SearchBar';

// The globe pulls in globe.gl and country data; only load it on the home page.
const GlobePage = lazy(() => import('./pages/GlobePage'));

function Brand() {
  return (
    <Link to="/" className="brand">
      <svg className="brand-mark" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="14" fill="#2f6b3a" />
        <path d="M9 20c3-8 11-8 14 0" stroke="#f2ede4" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="16" cy="11" r="2" fill="#f2ede4" />
      </svg>
      <span className="brand-name">Senecai</span>
    </Link>
  );
}

function useRestoreSource() {
  useEffect(() => {
    const { lastKind, kind, start } = usePipeline.getState();
    if (lastKind && !kind) void start(lastKind);
  }, []);
}

function Shell() {
  const home = useLocation().pathname === '/';
  return (
      <div className={`app ${home ? 'home' : ''}`}>
        <header className="header">
          <Brand />
          <SearchBar />
          <div className="spacer" />
          <SourcePill />
        </header>
        <main style={{ minHeight: 0, overflow: 'hidden' }}>
          <Suspense fallback={<div className="globe-loading">Loading the world…</div>}>
          <Routes>
            <Route path="/" element={<GlobePage />} />
            <Route path="/kantele" element={<KantelePage />} />
            <Route path="/piano" element={<PianoPage />} />
            <Route path="/craft/:id" element={<BenchPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/community/:id" element={<CreationPage />} />
          </Routes>
          </Suspense>
        </main>
        <InputPanel />
      </div>
  );
}

export function App() {
  useRestoreSource();
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}

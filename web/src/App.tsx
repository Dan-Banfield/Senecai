import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { usePipeline } from './input/pipeline';
import { InputPanel, SourcePill } from './ui/InputPanel';
import { SearchBar } from './ui/SearchBar';

// The globe pulls in globe.gl and country data; only load it on the home page.
const GlobePage = lazy(() => import('./pages/GlobePage'));
const OcarinaPage = lazy(() => import('./pages/OcarinaPage'));

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Senecai home">
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
      <div className={`app ${home ? 'home' : 'craft'}`}>
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
            <Route path="/craft/ocarina" element={<OcarinaPage />} />
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

import { useEffect } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import { usePipeline } from './input/pipeline';
import { CommunityPage } from './pages/CommunityPage';
import { CreationPage } from './pages/CreationPage';
import { HomePage } from './pages/HomePage';
import { KantelePage } from './pages/KantelePage';
import { KuksaPage } from './pages/KuksaPage';
import { InputPanel, SourcePill } from './ui/InputPanel';

function Brand() {
  return (
    <Link to="/" className="brand">
      <svg className="brand-mark" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="14" fill="#c87941" />
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

export function App() {
  useRestoreSource();
  return (
    <BrowserRouter>
      <div className="app">
        <header className="header">
          <Brand />
          <nav className="nav">
            <NavLink to="/kantele">Kantele</NavLink>
            <NavLink to="/kuksa">Kuksa</NavLink>
            <NavLink to="/community">Community</NavLink>
          </nav>
          <div className="spacer" />
          <SourcePill />
        </header>
        <main style={{ minHeight: 0, overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/kantele" element={<KantelePage />} />
            <Route path="/kuksa" element={<KuksaPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/community/:id" element={<CreationPage />} />
          </Routes>
        </main>
        <InputPanel />
      </div>
    </BrowserRouter>
  );
}

// Header search: find a country, a region or a craft and fly the globe there.
// Picking a result navigates to `/?country=…` or `/?craft=…`; the globe page
// reads that and lands.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CRAFTS } from '../crafts/catalog';

type Result =
  | { kind: 'country'; key: string; label: string; detail: string; country: string }
  | { kind: 'craft' | 'region'; key: string; label: string; detail: string; craftId: string };

const MAX_RESULTS = 8;
const KIND_LABEL: Record<Result['kind'], string> = { country: 'Country', region: 'Region', craft: 'Craft' };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Lower is better: exact, then prefix, then word-start, then anywhere. */
function rank(text: string, q: string): number {
  const t = norm(text);
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.split(/[\s,·-]+/).some((w) => w.startsWith(q))) return 2;
  return t.includes(q) ? 3 : -1;
}

export function SearchBar() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [countryNames, setCountryNames] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Country shapes are heavy, so only load the names when the search is first used.
  const loadCountries = () => {
    if (countryNames.length) return;
    void import('../globe/geo').then(({ loadCountries }) =>
      setCountryNames([...new Set(loadCountries().map((f) => f.properties.name))].sort()),
    );
  };

  const results = useMemo<Result[]>(() => {
    const q = norm(query.trim());
    if (!q) return [];
    const scored: { r: Result; s: number }[] = [];
    for (const name of countryNames) {
      const s = rank(name, q);
      if (s >= 0) {
        const n = CRAFTS.filter((c) => c.country === name).length;
        scored.push({ r: { kind: 'country', key: `country-${name}`, label: name, detail: n ? `${n} craft${n > 1 ? 's' : ''}` : 'no crafts yet', country: name }, s });
      }
    }
    for (const c of CRAFTS) {
      const s = Math.min(...[c.name, c.localName].map((t) => rank(t, q)).filter((x) => x >= 0), Infinity);
      if (s !== Infinity) scored.push({ r: { kind: 'craft', key: `craft-${c.id}`, label: c.name, detail: c.country, craftId: c.id }, s: s + 0.1 });
      const rs = rank(c.region, q);
      if (rs >= 0) scored.push({ r: { kind: 'region', key: `region-${c.id}`, label: c.region, detail: c.name, craftId: c.id }, s: rs + 0.2 });
    }
    return scored.sort((a, b) => a.s - b.s).slice(0, MAX_RESULTS).map((x) => x.r);
  }, [query, countryNames]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const pick = (r: Result) => {
    const params: Record<string, string> = r.kind === 'country' ? { country: r.country } : { craft: r.craftId };
    navigate(`/?${new URLSearchParams(params)}`);
    setQuery('');
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + results.length) % results.length);
      setOpen(true);
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      e.currentTarget.blur();
    }
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className="search" ref={rootRef}>
      <svg className="search-icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        className="search-input"
        placeholder="Search a country, region or craft"
        aria-label="Search a country, region or craft"
        role="combobox"
        aria-expanded={showList}
        aria-controls="search-results"
        aria-activedescendant={showList && results[active] ? `search-${results[active].key}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          loadCountries();
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul className="search-results" id="search-results" role="listbox">
          {results.length === 0 && <li className="search-empty">No matches for “{query.trim()}”</li>}
          {results.map((r, i) => (
            <li
              key={r.key}
              id={`search-${r.key}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(r)}
            >
              <span className="search-label">{r.label}</span>
              <span className="search-detail">{r.detail}</span>
              <span className={`search-kind ${r.kind}`}>{KIND_LABEL[r.kind]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

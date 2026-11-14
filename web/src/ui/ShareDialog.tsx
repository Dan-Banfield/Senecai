import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { community, type NewCreation } from '../community/api';
import { DEFAULT_PLACE, PLACES, placeByName, type GeoPoint } from '../community/places';

const NAME_KEY = 'senecai.author';
const PLACE_KEY = 'senecai.place';
const MY_LOCATION = '__mine__';

export function ShareDialog({ draft, onClose }: { draft: Omit<NewCreation, 'title' | 'author' | 'description' | 'location'>; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [placeName, setPlaceName] = useState(() => {
    const saved = localStorage.getItem(PLACE_KEY);
    return saved && placeByName(saved) ? saved : DEFAULT_PLACE.place;
  });
  const [mine, setMine] = useState<GeoPoint | null>(null);
  const [geoError, setGeoError] = useState('');
  const navigate = useNavigate();

  const locateMe = () => {
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      // Rounded to ~10 km: enough for a pin on the globe, not a home address.
      (pos) => {
        setMine({ lat: Math.round(pos.coords.latitude * 10) / 10, lng: Math.round(pos.coords.longitude * 10) / 10, place: 'Near me' });
        setPlaceName(MY_LOCATION);
      },
      () => setGeoError('Location unavailable. Pick a place from the list instead.'),
      { timeout: 8000 },
    );
  };
  const location = placeName === MY_LOCATION && mine ? mine : (placeByName(placeName) ?? DEFAULT_PLACE);

  const submit = async () => {
    setBusy(true);
    localStorage.setItem(NAME_KEY, author);
    if (placeName !== MY_LOCATION) localStorage.setItem(PLACE_KEY, placeName);
    const c = await community.create({ ...draft, title: title || 'Untitled', author: author || 'Anonymous', description, location });
    navigate(`/community/${c.id}`);
  };

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal">
        <h2>Share with the community</h2>
        <p style={{ margin: 0, color: 'var(--birch-dim)' }}>Others can replay your robot's movements and learn your creation as a tutorial. It's also saved as a teleoperation demonstration that a robot can learn from.</p>
        <label className="field">
          Title
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={draft.craft === 'kantele' ? 'e.g. Song for the first snow' : 'e.g. My first puukko'} autoFocus />
        </label>
        <label className="field">
          Your name
          <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Anonymous" />
        </label>
        <label className="field">
          Where in the world are you? (your creation appears on the globe)
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select style={{ flex: 1 }} value={placeName} onChange={(e) => setPlaceName(e.target.value)}>
              {mine && <option value={MY_LOCATION}>📍 Near me ({mine.lat}, {mine.lng})</option>}
              {PLACES.map((p) => (
                <option key={p.place} value={p.place}>
                  {p.place}
                </option>
              ))}
            </select>
            <button type="button" className="btn small" onClick={locateMe}>
              Use my location
            </button>
          </div>
          {geoError && <span style={{ color: 'var(--warn)' }}>{geoError}</span>}
        </label>
        <label className="field">
          Notes for learners
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tips, inspiration, the story behind it…" />
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Sharing…' : 'Share'}</button>
        </div>
      </div>
    </>
  );
}

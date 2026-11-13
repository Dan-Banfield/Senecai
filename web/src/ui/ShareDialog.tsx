import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { community, type NewCreation } from '../community/api';

const NAME_KEY = 'senecai.author';

export function ShareDialog({ draft, onClose }: { draft: Omit<NewCreation, 'title' | 'author' | 'description'>; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async () => {
    setBusy(true);
    localStorage.setItem(NAME_KEY, author);
    const c = await community.create({ ...draft, title: title || 'Untitled', author: author || 'Anonymous', description });
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
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={draft.craft === 'kantele' ? 'e.g. Song for the first snow' : 'e.g. My first kuksa'} autoFocus />
        </label>
        <label className="field">
          Your name
          <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Anonymous" />
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

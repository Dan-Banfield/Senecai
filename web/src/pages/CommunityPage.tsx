import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { community, type Creation } from '../community/api';
import type { CraftId } from '../recording/recording';
import { CreationThumb } from '../ui/Thumbnails';

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function LikeButton({ creation, onChange }: { creation: Creation; onChange: (c: Creation) => void }) {
  return (
    <button
      className={`like ${creation.liked ? 'on' : ''}`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const c = await community.like(creation.id);
        if (c) onChange(c);
      }}
    >
      {creation.liked ? '♥' : '♡'} {creation.likes}
    </button>
  );
}

export function CommunityPage() {
  const [filter, setFilter] = useState<CraftId | undefined>();
  const [items, setItems] = useState<Creation[] | null>(null);

  useEffect(() => {
    setItems(null);
    void community.list({ craft: filter }).then(setItems);
  }, [filter]);

  return (
    <div className="community">
      <div className="community-head">
        <div>
          <h1>Community</h1>
          <p>Every creation is a recording of real hand movements. Watch the robot replay it, or turn it into a tutorial and learn it yourself.</p>
        </div>
        <div className="tabs" style={{ minWidth: 300 }}>
          <button className={!filter ? 'on' : ''} onClick={() => setFilter(undefined)}>All</button>
          <button className={filter === 'kantele' ? 'on' : ''} onClick={() => setFilter('kantele')}>Kantele</button>
          <button className={filter === 'kuksa' ? 'on' : ''} onClick={() => setFilter('kuksa')}>Kuksa</button>
        </div>
      </div>
      {!items ? (
        <div className="empty">Loading…</div>
      ) : (
        <div className="grid">
          {items.map((c) => (
            <Link key={c.id} to={`/community/${c.id}`} className="creation">
              <div className="thumb">
                <CreationThumb creation={c} />
              </div>
              <div className="info">
                <div>
                  <span className="tag">{c.craft}</span>
                  {c.score !== undefined && <span className="tag">score {c.score}</span>}
                  {c.learnedFrom && <span className="tag">remix</span>}
                </div>
                <h3>{c.title}</h3>
                <div className="meta">
                  <span>
                    {c.author} · {timeAgo(c.createdAt)}
                  </span>
                  <LikeButton creation={c} onChange={(n) => setItems((list) => list?.map((x) => (x.id === n.id ? n : x)) ?? null)} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

import { Link } from 'react-router-dom';

function KanteleArt() {
  return (
    <svg width="260" height="130" viewBox="0 0 260 130">
      <path d="M20 95 L235 70 Q250 60 236 44 L60 22 Q18 30 20 95 Z" fill="#b07a4a" stroke="#7a4b28" strokeWidth="2" />
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1={44} y1={40 + i * 11} x2={228} y2={52 + i * 4} stroke="#ece4d2" strokeWidth={1.4 - i * 0.15} />
      ))}
      <circle cx="120" cy="60" r="9" fill="none" stroke="#7a4b28" strokeWidth="2" />
    </svg>
  );
}

function KuksaArt() {
  return (
    <svg width="220" height="130" viewBox="0 0 220 130">
      <path d="M40 40 Q40 118 110 118 Q170 118 172 52 L200 46 Q212 44 210 32 Q206 24 194 26 L40 30 Z" fill="#d8b98b" stroke="#8a5a33" strokeWidth="2" />
      <ellipse cx="106" cy="34" rx="66" ry="10" fill="#8a5a33" />
      <circle cx="196" cy="35" r="5" fill="#1a2224" />
    </svg>
  );
}

export function HomePage() {
  return (
    <div className="home">
      <section className="hero">
        <div>
          <div className="eyebrow">Junction 2026 · Rokoko teleoperation track</div>
          <h1>
            Old crafts.
            <br />
            <em>New hands.</em>
          </h1>
          <p className="lead">
            Senecai lets anyone teach a robot hand the traditional crafts of Finland. Wear Rokoko Smartgloves (or just use your webcam), learn to play the kantele or carve a kuksa through a
            robot's fingers, then share your creations so others, human or robot, can learn from your hands.
          </p>
          <div className="row">
            <Link to="/kantele" className="btn primary">Play the kantele</Link>
            <Link to="/kuksa" className="btn">Carve a kuksa</Link>
            <Link to="/community" className="btn ghost">Explore the community →</Link>
          </div>
        </div>
        <div className="pipeline-diagram">
          <ol>
            <li><span className="n">1</span><div><b>Your hands</b><span>Rokoko Smartgloves, or a webcam emulator that streams the exact same JSON v3 frames</span></div></li>
            <li><span className="n">2</span><div><b>Retargeting</b><span>About 20 human finger joints become 6 robot actuators (Inspire-style dexterous hand), calibrated to you</span></div></li>
            <li><span className="n">3</span><div><b>The robot crafts</b><span>Plucking strings or carving wood in a simulated workshop, ready to mirror to a real hand</span></div></li>
            <li><span className="n">4</span><div><b>Demonstrations</b><span>Every creation is a teleoperation recording: a tutorial for people and training data for robots</span></div></li>
          </ol>
        </div>
      </section>

      <section className="crafts">
        <Link to="/kantele" className="craft-card">
          <div className="art"><KanteleArt /></div>
          <div className="body">
            <span className="tag">music</span>
            <span className="tag">fine finger control</span>
            <h2>Kantele</h2>
            <div className="fi">Finland's national instrument</div>
            <p>Five strings, five fingers. Traditional playing gives each finger its own string, so a five-finger robot hand is a natural fit. Start with guided lessons, then compose your own.</p>
          </div>
        </Link>
        <Link to="/kuksa" className="craft-card">
          <div className="art"><KuksaArt /></div>
          <div className="body">
            <span className="tag">woodcraft</span>
            <span className="tag">tool use · force control</span>
            <h2>Kuksa</h2>
            <div className="fi">the birch-burl cup of the North</div>
            <p>Guide a robot hand holding a puukko knife to carve a cup from a birch burl. Your grip sets the pressure: shave lightly near the walls, take big chips elsewhere.</p>
          </div>
        </Link>
      </section>

      <section className="story">
        <h2>Why teach crafts to robots?</h2>
        <p>
          Traditional crafts are disappearing with the hands that know them. Motion capture can record what a master's hands actually do, not just what a video shows. Senecai turns those
          recordings into tutorials anyone can follow with a ghost hand as their guide. Every session is also a teleoperation demonstration of delicate tool use and fine finger control, which is
          exactly the data needed to train robots to manipulate the physical world.
        </p>
      </section>
    </div>
  );
}

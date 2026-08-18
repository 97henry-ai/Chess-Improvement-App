import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';

const CATEGORIES = ['tactics', 'openings', 'endgames', 'strategy', 'mindset'];

export default function Lessons() {
  const { username } = useUser();
  const [lessons, setLessons] = useState([]);
  const [weakness, setWeakness] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getLessons().then(setLessons).catch((e) => setError(e.message));
    if (username) {
      api.getWeaknessProfile(username).then(setWeakness).catch(() => {});
    }
  }, [username]);

  const recommended = new Set(weakness?.recommendedLessons || []);
  const visible = filter === 'all' ? lessons : lessons.filter((l) => l.category === filter);
  const sorted = [...visible].sort((a, b) => (recommended.has(b.id) ? 1 : 0) - (recommended.has(a.id) ? 1 : 0));

  return (
    <div>
      <h1>Lesson Library</h1>
      <p>Curated lessons on tactics, openings, endgames, and strategy — highlighted picks are tailored to your weaknesses.</p>

      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}>{error}</div>}

      <div className="badge-row" style={{ marginBottom: 20 }}>
        <button className={`btn ${filter === 'all' ? '' : 'secondary'}`} onClick={() => setFilter('all')}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c} className={`btn ${filter === c ? '' : 'secondary'}`} onClick={() => setFilter(c)}>
            {c}
          </button>
        ))}
      </div>

      {username && !weakness?.recommendedLessons?.length && (
        <div className="card" style={{ marginBottom: 20 }}>
          <p>Analyze some games and try a few puzzles — we'll recommend lessons based on your actual mistakes.</p>
        </div>
      )}

      <div className="grid grid-3">
        {sorted.map((lesson) => (
          <Link key={lesson.id} to={`/lessons/${lesson.id}`} className="card" style={{ textDecoration: 'none', display: 'block' }}>
            {recommended.has(lesson.id) && <span className="tag win" style={{ marginBottom: 8 }}>Recommended for you</span>}
            <h3>{lesson.title}</h3>
            <p>{lesson.summary}</p>
            <div className="badge-row">
              <span className="tag">{lesson.category}</span>
              <span className="tag">{lesson.level}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

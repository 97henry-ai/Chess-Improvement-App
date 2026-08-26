import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';
import { BOOKS, SITES } from '../data/resources.js';

const CATEGORIES = ['tactics', 'openings', 'endgames', 'strategy', 'mindset'];

export default function Lessons() {
  const { username } = useUser();
  const [lessons, setLessons] = useState([]);
  const [weakness, setWeakness] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [showResources, setShowResources] = useState(false);

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
      <p>
        Curated lessons on tactics, openings, endgames, strategy, and mindset — each grounded in a specific classic book
        or well-known training resource. Highlighted picks are tailored to your weaknesses.
      </p>

      {error && <div className="card error-banner" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="badge-row" role="tablist" aria-label="Filter lessons by category" style={{ marginBottom: 20 }}>
        <button role="tab" aria-selected={filter === 'all'} className={`btn ${filter === 'all' ? '' : 'secondary'}`} onClick={() => setFilter('all')}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c} role="tab" aria-selected={filter === c} className={`btn ${filter === c ? '' : 'secondary'}`} onClick={() => setFilter(c)}>
            {c}
          </button>
        ))}
        <button
          className="btn secondary"
          aria-expanded={showResources}
          style={{ marginLeft: 'auto' }}
          onClick={() => setShowResources((v) => !v)}
        >
          {showResources ? 'Hide' : 'Show'} best books &amp; sites
        </button>
      </div>

      {showResources && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3>Best chess books &amp; sites</h3>
          <p>
            A curated list of the resources this lesson library draws on — well worth going straight to the source once
            a topic here catches your interest.
          </p>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div>
              <h3 style={{ fontSize: '1rem' }}>Books</h3>
              <ul className="list-plain">
                {BOOKS.map((b) => (
                  <li key={b.title} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600 }}>{b.title}</div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--text-dim)', margin: '3px 0 7px' }}>
                      {b.author} · {b.level}
                    </div>
                    <div style={{ fontSize: '0.95rem' }}>{b.note}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 style={{ fontSize: '1rem' }}>Sites</h3>
              <ul className="list-plain">
                {SITES.map((s) => (
                  <li key={s.name} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600 }}>
                      <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>
                    </div>
                    <div style={{ fontSize: '0.95rem', marginTop: 5 }}>{s.note}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

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
            {lesson.source && (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: 10, marginBottom: 0 }}>{lesson.source}</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

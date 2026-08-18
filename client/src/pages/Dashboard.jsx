import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';

const TIME_CLASS_LABELS = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily' };

export default function Dashboard() {
  const { username, setUsername } = useUser();
  const [input, setInput] = useState(username);
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [summary, setSummary] = useState(null);
  const [games, setGames] = useState([]);
  const [weakness, setWeakness] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  async function loadAll(name) {
    setLoading(true);
    setError('');
    try {
      const [p, s, sum, gs, w] = await Promise.all([
        api.getProfile(name).catch(() => null),
        api.getStats(name).catch(() => null),
        api.getGamesSummary(name).catch(() => null),
        api.getGames(name, 10).catch(() => []),
        api.getWeaknessProfile(name).catch(() => null),
      ]);
      setProfile(p);
      setStats(s);
      setSummary(sum);
      setGames(gs);
      setWeakness(w);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (username) loadAll(username);
  }, [username]);

  async function handleConnect(e) {
    e.preventDefault();
    if (!input.trim()) return;
    setUsername(input.trim().toLowerCase());
  }

  async function handleSync() {
    setSyncing(true);
    setError('');
    try {
      await api.syncGames(username, 3);
      await api.recomputeWeaknessProfile(username).catch(() => {});
      await loadAll(username);
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  const ratingBlitz = stats?.chess_blitz?.last?.rating;
  const ratingRapid = stats?.chess_rapid?.last?.rating;
  const ratingBullet = stats?.chess_bullet?.last?.rating;

  return (
    <div>
      <h1>Welcome to ChessCoach</h1>
      <p>Link your chess.com account to get a personalized improvement plan built from your own games.</p>

      <form onSubmit={handleConnect} style={{ display: 'flex', gap: 10, margin: '18px 0 28px' }}>
        <input
          className="input"
          placeholder="chess.com username"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ flex: 1, maxWidth: 320 }}
        />
        <button className="btn" type="submit">Connect</button>
        {username && (
          <button className="btn secondary" type="button" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing games…' : 'Sync recent games'}
          </button>
        )}
      </form>

      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 20 }}>{error}</div>}

      {!username && (
        <div className="empty-state card">Enter your chess.com username above to get started.</div>
      )}

      {username && loading && <p>Loading your chess data…</p>}

      {username && !loading && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 24 }}>
            <div className="stat-tile">
              <div className="value">{ratingRapid ?? '—'}</div>
              <div className="label">Rapid rating</div>
            </div>
            <div className="stat-tile">
              <div className="value">{ratingBlitz ?? '—'}</div>
              <div className="label">Blitz rating</div>
            </div>
            <div className="stat-tile">
              <div className="value">{ratingBullet ?? '—'}</div>
              <div className="label">Bullet rating</div>
            </div>
            <div className="stat-tile">
              <div className="value">{summary?.total ?? 0}</div>
              <div className="label">Games stored</div>
            </div>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <h3>Recent record</h3>
              {summary ? (
                <div className="badge-row">
                  <span className="tag win">{summary.wins} wins</span>
                  <span className="tag loss">{summary.losses} losses</span>
                  <span className="tag draw">{summary.draws} draws</span>
                </div>
              ) : (
                <p>No games synced yet.</p>
              )}
              <h3 style={{ marginTop: 18 }}>Recent games</h3>
              {games.length === 0 && <p>Click "Sync recent games" to import your chess.com history.</p>}
              <ul className="list-plain">
                {games.map((g) => (
                  <li key={g.id} className="move-row">
                    <span>
                      {g.player_color === 'white' ? 'White' : 'Black'} · {TIME_CLASS_LABELS[g.time_class] || g.time_class} ·{' '}
                      {g.opening_name || 'Unknown opening'}
                    </span>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className={`tag ${g.player_result}`}>{g.player_result}</span>
                      <Link className="btn secondary" to={`/analyzer/${g.id}`} style={{ padding: '5px 12px', fontSize: '0.85rem' }}>
                        Analyze
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card">
              <h3>Your improvement focus</h3>
              {weakness?.themes?.length ? (
                <>
                  <p>Based on your blunders and puzzle results, focus on these themes:</p>
                  <div className="badge-row">
                    {weakness.themes.slice(0, 6).map((t) => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                  </div>
                  <Link className="btn" to="/lessons">View recommended lessons</Link>
                </>
              ) : (
                <p>Analyze a few games and solve some puzzles — we'll build a personalized weakness profile from there.</p>
              )}

              <h3 style={{ marginTop: 22 }}>Suggested next step</h3>
              <p>
                {games.length === 0
                  ? 'Sync your games to get started.'
                  : 'Open a recent game in the Analyzer to find your mistakes, then turn them into custom puzzles.'}
              </p>
              <Link className="btn secondary" to="/puzzles">Go to puzzle trainer</Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

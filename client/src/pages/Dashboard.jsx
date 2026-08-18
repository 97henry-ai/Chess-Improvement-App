import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';
import { analyzeGamesBatch } from '../engine/analyzeGame.js';

const TIME_CLASS_LABELS = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily' };

const PHASE_INFO = {
  opening: { label: 'Opening', description: 'Your first ~8 moves each game', lessonCategory: 'openings' },
  middlegame: { label: 'Middlegame', description: 'The tactical heart of the game', lessonCategory: 'tactics' },
  endgame: { label: 'Endgame', description: 'The final stretch, fewer pieces on the board', lessonCategory: 'endgames' },
};

/** Average centipawn loss (ACPL) bands, roughly matching how chess.com/Lichess describe accuracy at club level. */
function acplLevel(acpl) {
  if (acpl <= 40) return { label: 'Strong', tone: 'win' };
  if (acpl <= 80) return { label: 'Solid', tone: '' };
  if (acpl <= 150) return { label: 'Needs work', tone: 'draw' };
  return { label: 'Priority focus', tone: 'loss' };
}

function buildTrainingPlan(performance, lessons) {
  if (!performance || !performance.overall || performance.overall.moves === 0) return [];

  const ranked = Object.entries(performance.phases)
    .filter(([, p]) => p.moves >= 3)
    .sort((a, b) => b[1].acpl - a[1].acpl);

  return ranked.slice(0, 3).map(([phase, stats]) => {
    const info = PHASE_INFO[phase];
    const level = acplLevel(stats.acpl);
    const recommended = lessons.filter((l) => l.category === info.lessonCategory).slice(0, 2);
    return { phase, info, stats, level, recommended };
  });
}

export default function Dashboard() {
  const { username, setUsername } = useUser();
  const [input, setInput] = useState(username);
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [summary, setSummary] = useState(null);
  const [games, setGames] = useState([]);
  const [weakness, setWeakness] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState('');
  const [error, setError] = useState('');

  async function loadAll(name) {
    setLoading(true);
    setError('');
    try {
      const [p, s, sum, gs, w, perf, ls] = await Promise.all([
        api.getProfile(name).catch(() => null),
        api.getStats(name).catch(() => null),
        api.getGamesSummary(name).catch(() => null),
        api.getGames(name, 10).catch(() => []),
        api.getWeaknessProfile(name).catch(() => null),
        api.getPerformance(name).catch(() => null),
        api.getLessons().catch(() => []),
      ]);
      setProfile(p);
      setStats(s);
      setSummary(sum);
      setGames(gs);
      setWeakness(w);
      setPerformance(perf);
      setLessons(ls);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Automatically analyze every synced-but-unanalyzed game with Stockfish, in the
  // background, without requiring the user to open each game individually.
  async function runAutoAnalysis(name) {
    if (analyzing) return;
    let unanalyzed;
    try {
      const all = await api.getGames(name, 200);
      unanalyzed = all.filter((g) => !g.analyzed);
    } catch {
      return;
    }
    if (unanalyzed.length === 0) return;

    setAnalyzing(true);
    setAnalysisProgress(`Analyzing game 1 of ${unanalyzed.length}…`);
    try {
      await analyzeGamesBatch(unanalyzed, {
        saveGameAnalysis: api.saveGameAnalysis,
        onGameProgress: (gameIndex, totalGames) => {
          setAnalysisProgress(`Analyzing game ${gameIndex} of ${totalGames}…`);
        },
      });
      await api.recomputeWeaknessProfile(name).catch(() => {});
      await loadAll(name);
    } finally {
      setAnalyzing(false);
      setAnalysisProgress('');
    }
  }

  useEffect(() => {
    if (username) {
      loadAll(username).then(() => runAutoAnalysis(username));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      await loadAll(username);
      await runAutoAnalysis(username);
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  const ratingBlitz = stats?.chess_blitz?.last?.rating;
  const ratingRapid = stats?.chess_rapid?.last?.rating;
  const ratingBullet = stats?.chess_bullet?.last?.rating;
  const trainingPlan = buildTrainingPlan(performance, lessons);

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
          <button className="btn secondary" type="button" onClick={handleSync} disabled={syncing || analyzing}>
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
          {analyzing && (
            <div className="card" style={{ marginBottom: 20, borderColor: 'var(--accent)' }}>
              <p style={{ margin: 0 }}>
                <strong>Auto-analyzing your games with Stockfish…</strong> {analysisProgress} This runs automatically
                whenever new games are synced — feel free to keep browsing.
              </p>
            </div>
          )}

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

          {performance?.gamesAnalyzed > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h3>Performance summary</h3>
              <p>
                Based on {performance.gamesAnalyzed} Stockfish-analyzed game{performance.gamesAnalyzed === 1 ? '' : 's'},
                broken down into the three basic phases of a chess game. Lower average centipawn loss (ACPL) is better.
              </p>
              <div className="grid grid-3" style={{ marginTop: 14 }}>
                {Object.entries(performance.phases).map(([phase, phaseStats]) => {
                  const info = PHASE_INFO[phase];
                  const level = phaseStats.moves >= 3 ? acplLevel(phaseStats.acpl) : null;
                  return (
                    <div key={phase} className="stat-tile">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div className="value">{phaseStats.moves >= 3 ? phaseStats.acpl : '—'}</div>
                          <div className="label">{info.label} ACPL</div>
                        </div>
                        {level && <span className={`tag ${level.tone}`}>{level.label}</span>}
                      </div>
                      <p className="text-small" style={{ marginTop: 10, marginBottom: 0 }}>
                        {phaseStats.moves >= 3
                          ? `${phaseStats.blunders} blunder${phaseStats.blunders === 1 ? '' : 's'}, ${phaseStats.mistakes} mistake${phaseStats.mistakes === 1 ? '' : 's'} across ${phaseStats.moves} moves.`
                          : `Not enough ${info.description.toLowerCase()} moves analyzed yet.`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {trainingPlan.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h3>Your training plan</h3>
              <p>Ranked by where you're losing the most points on average — start at the top.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
                {trainingPlan.map((item, i) => (
                  <div key={item.phase} className="stat-tile">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <strong>{i + 1}. {item.info.label}</strong>{' '}
                        <span className={`tag ${item.level.tone}`}>{item.level.label}</span>
                      </div>
                      <span className="text-small">~{item.stats.acpl} ACPL · {item.stats.blunders} blunders</span>
                    </div>
                    {item.recommended.length > 0 && (
                      <div className="badge-row" style={{ marginBottom: 0, marginTop: 10 }}>
                        {item.recommended.map((l) => (
                          <Link key={l.id} className="btn secondary" to={`/lessons/${l.id}`} style={{ padding: '5px 12px', fontSize: '0.85rem' }}>
                            {l.title}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <Link className="btn" to="/puzzles" style={{ marginTop: 16, display: 'inline-block' }}>
                Practice with puzzles
              </Link>
            </div>
          )}

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
                      {!g.analyzed && <span className="tag" style={{ marginLeft: 8 }}>pending analysis</span>}
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

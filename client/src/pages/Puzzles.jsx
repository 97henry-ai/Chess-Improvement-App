import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';
import { useChessInteraction } from '../engine/useChessInteraction.js';
import { playMoveSound } from '../engine/sound.js';
import { highestRating } from '../ratingUtils.js';
import { explainPuzzleStep } from '../engine/puzzleExplain.js';
import CoachAvatar from '../components/CoachAvatar.jsx';

const EMPTY_CHESS = new Chess();

function normalizeSan(san) {
  return san?.replace('+', '').replace('#', '');
}

function puzzleRef(puzzle) {
  return `${puzzle.source}:${puzzle.id}`;
}

function dailyProgressKey(username, date) {
  return `dailyPuzzleProgress:${username}:${date}`;
}

function loadDailyProgress(username, date) {
  try {
    const raw = localStorage.getItem(dailyProgressKey(username, date));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDailyProgress(username, date, solvedSet) {
  try {
    localStorage.setItem(dailyProgressKey(username, date), JSON.stringify([...solvedSet]));
  } catch {
    /* localStorage unavailable — progress just won't persist across reloads */
  }
}

// Tracks every puzzle (any source) a player has ever solved, so previously-solved
// puzzles can be marked and pushed to the back of the queue instead of resurfacing
// as if new. Curated puzzles have no server-side attempt record (their ids aren't
// database rows), so this is the only place that memory lives for them.
function solvedEverKey(username) {
  return `solvedPuzzlesEver:${username}`;
}

function loadSolvedEver(username) {
  try {
    const raw = localStorage.getItem(solvedEverKey(username));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveSolvedEver(username, solvedSet) {
  try {
    localStorage.setItem(solvedEverKey(username), JSON.stringify([...solvedSet]));
  } catch {
    /* non-critical */
  }
}

export default function Puzzles() {
  const { username } = useUser();
  const [source, setSource] = useState('daily'); // 'daily' | 'mine' | 'curated'
  const [customPuzzles, setCustomPuzzles] = useState([]);
  const [curatedPuzzles, setCuratedPuzzles] = useState([]);
  const [dailyPuzzles, setDailyPuzzles] = useState([]);
  const [dailyDate, setDailyDate] = useState(null);
  const [dailySolved, setDailySolved] = useState(new Set());
  const [index, setIndex] = useState(0);
  const [chess, setChess] = useState(null);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState('playing'); // 'playing' | 'correct' | 'wrong'
  const [stats, setStats] = useState(null);
  const [chessComRating, setChessComRating] = useState(null);
  const [ratingLoaded, setRatingLoaded] = useState(false);
  const [error, setError] = useState('');
  const [explanation, setExplanation] = useState(null); // { why, solutionWhy } | null
  const [explaining, setExplaining] = useState(false);
  const explainTokenRef = useRef(0);
  const [solvedEver, setSolvedEver] = useState(new Set());
  const [mistakeContext, setMistakeContext] = useState(null); // { moveSan, fenAfter } | null

  useEffect(() => {
    if (username) {
      setRatingLoaded(false);
      setSolvedEver(loadSolvedEver(username));
      api.getCustomPuzzles(username).then(setCustomPuzzles).catch((e) => setError(e.message));
      api.getPuzzleStats(username).then(setStats).catch(() => {});
      api
        .getStats(username)
        .then((s) => setChessComRating(highestRating(s)))
        .catch(() => setChessComRating(null))
        .finally(() => setRatingLoaded(true));
    } else {
      setChessComRating(null);
      setRatingLoaded(true);
      setSolvedEver(new Set());
    }
  }, [username]);

  function markSolvedEver(puzzleToMark) {
    if (!username || !puzzleToMark) return;
    setSolvedEver((prev) => {
      const next = new Set(prev);
      next.add(puzzleRef(puzzleToMark));
      saveSolvedEver(username, next);
      return next;
    });
  }

  // Wait until we know the player's rating (or that none is available) before
  // requesting the curated/daily sets, since the daily plan is generated once
  // per day server-side — fetching too early would lock in an uncalibrated plan.
  useEffect(() => {
    if (!ratingLoaded) return;
    api
      .getCuratedPuzzles(chessComRating ? { near: chessComRating } : {})
      .then(setCuratedPuzzles)
      .catch((e) => setError(e.message));

    if (username) {
      api
        .getDailyPuzzles(username, chessComRating || undefined)
        .then((d) => {
          setDailyPuzzles(d.puzzles);
          setDailyDate(d.date);
          setDailySolved(loadDailyProgress(username, d.date));
        })
        .catch((e) => setError(e.message));
    } else {
      setDailyPuzzles([]);
      setDailyDate(null);
      setDailySolved(new Set());
    }
  }, [ratingLoaded, chessComRating, username]);

  // Puzzles already solved before are kept in the set (so you can still replay
  // them deliberately) but pushed to the back of the queue rather than
  // resurfacing ahead of ones you haven't cracked yet.
  function deprioritizeSolved(list) {
    if (!username || solvedEver.size === 0) return list;
    const unsolved = list.filter((p) => !solvedEver.has(puzzleRef(p)));
    const solved = list.filter((p) => solvedEver.has(puzzleRef(p)));
    return [...unsolved, ...solved];
  }

  const orderedCustom = useMemo(() => deprioritizeSolved(customPuzzles), [customPuzzles, solvedEver, username]);
  const orderedCurated = useMemo(() => deprioritizeSolved(curatedPuzzles), [curatedPuzzles, solvedEver, username]);

  const queue = source === 'mine' ? orderedCustom : source === 'daily' ? dailyPuzzles : orderedCurated;
  const puzzle = queue[index];
  const alreadySolved = puzzle && solvedEver.has(puzzleRef(puzzle));

  const { options: interactionOptions, reset, setLastMove } = useChessInteraction({
    chess: chess || EMPTY_CHESS,
    disabled: !chess || !puzzle || status === 'correct',
    onMoveMade: handleMoveMade,
  });

  useEffect(() => {
    setIndex(0);
  }, [source]);

  useEffect(() => {
    if (puzzle) {
      setChess(new Chess(puzzle.fen));
      setStep(0);
      setStatus(source === 'daily' && dailySolved.has(puzzleRef(puzzle)) ? 'correct' : 'playing');
      reset();
    } else {
      setChess(null);
    }
    setExplanation(null);
    setExplaining(false);
    explainTokenRef.current++;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle?.id, puzzle?.source]);

  // For puzzles built from a real blunder, load the actual game so we can show
  // a second board with the move the player really played, for comparison.
  useEffect(() => {
    setMistakeContext(null);
    if (!puzzle || puzzle.source !== 'custom' || !puzzle.game_id) return;
    let cancelled = false;
    api
      .getGameDetail(puzzle.game_id)
      .then((game) => {
        if (cancelled) return;
        const playedMove = game.moves?.find((m) => m.fen_before === puzzle.fen);
        if (playedMove) {
          setMistakeContext({
            moveSan: playedMove.move_san,
            fenAfter: playedMove.fen_after,
            opponent: game.player_color === 'white' ? game.black : game.white,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [puzzle?.id, puzzle?.source, puzzle?.game_id, puzzle?.fen]);

  /** Ask the engine why the correct move works, and (if given) why an attempt fell short. */
  async function runExplanation(fenBefore, correctSan, attemptedSan) {
    const token = ++explainTokenRef.current;
    setExplaining(true);
    try {
      const moverColor = fenBefore.split(' ')[1];
      const result = await explainPuzzleStep({ fenBefore, correctSan, attemptedSan, moverColor, theme: puzzle?.theme });
      if (token === explainTokenRef.current) setExplanation(result);
    } catch {
      /* engine explanation is a nice-to-have, not critical to puzzle function */
    } finally {
      if (token === explainTokenRef.current) setExplaining(false);
    }
  }

  function revealAnswer() {
    if (!chess || !puzzle) return;
    setExplanation(null);
    runExplanation(chess.fen(), puzzle.solution_san[step], null);
  }

  const boardOrientation = useMemo(() => {
    if (!puzzle) return 'white';
    return puzzle.fen.split(' ')[1] === 'w' ? 'white' : 'black';
  }, [puzzle]);

  async function recordAttempt(correct) {
    if (!username || !puzzle || typeof puzzle.id !== 'number') return;
    try {
      await api.recordPuzzleAttempt(puzzle.id, username, correct);
      api.getPuzzleStats(username).then(setStats).catch(() => {});
    } catch {
      /* non-critical */
    }
  }

  function markSolvedIfDaily() {
    if (source !== 'daily' || !puzzle || !username || !dailyDate) return;
    setDailySolved((prev) => {
      const next = new Set(prev);
      next.add(puzzleRef(puzzle));
      saveDailyProgress(username, dailyDate, next);
      return next;
    });
  }

  function handleMoveMade(move) {
    if (!puzzle) return;
    const expected = normalizeSan(puzzle.solution_san[step]);
    if (normalizeSan(move.san) !== expected) {
      chess.undo();
      setStatus('wrong');
      playMoveSound('wrong');
      recordAttempt(false);
      setExplanation(null);
      runExplanation(move.before, puzzle.solution_san[step], move.san);
      return;
    }

    setExplanation(null);
    const nextStep = step + 1;
    if (nextStep >= puzzle.solution_san.length) {
      setStatus('correct');
      playMoveSound('success');
      recordAttempt(true);
      markSolvedIfDaily();
      markSolvedEver(puzzle);
      setStep(nextStep);
      runExplanation(move.before, move.san, null);
      return;
    }

    // Auto-play the opponent's reply move in the solution line, then wait for the next user move.
    const replySan = puzzle.solution_san[nextStep];
    setTimeout(() => {
      try {
        const replyMove = chess.move(replySan);
        if (replyMove) {
          setLastMove({ from: replyMove.from, to: replyMove.to });
          playMoveSound(chess.isCheck() ? 'check' : replyMove.captured ? 'capture' : 'move');
        }
        setStep(nextStep + 1);
        if (nextStep + 1 >= puzzle.solution_san.length) {
          setStatus('correct');
          recordAttempt(true);
          markSolvedIfDaily();
          markSolvedEver(puzzle);
        }
      } catch {
        /* ignore malformed curated data */
      }
    }, 400);
  }

  function nextPuzzle() {
    setIndex((i) => (i + 1 < queue.length ? i + 1 : 0));
  }

  const dailySolvedCount = dailyPuzzles.filter((p) => dailySolved.has(puzzleRef(p))).length;
  const dailyComplete = dailyPuzzles.length > 0 && dailySolvedCount === dailyPuzzles.length;

  return (
    <div>
      <h1>Puzzle Trainer</h1>
      <p>A fresh personalized set of 10 every day, plus your own blunders and our full curated tactics set.</p>

      <div className="badge-row" role="tablist" aria-label="Puzzle set" style={{ marginBottom: 18 }}>
        <button
          role="tab"
          aria-selected={source === 'daily'}
          className={`btn ${source === 'daily' ? '' : 'secondary'}`}
          onClick={() => setSource('daily')}
        >
          Today's 10 {dailyPuzzles.length > 0 ? `(${dailySolvedCount}/${dailyPuzzles.length})` : ''}
        </button>
        <button
          role="tab"
          aria-selected={source === 'mine'}
          className={`btn ${source === 'mine' ? '' : 'secondary'}`}
          onClick={() => setSource('mine')}
        >
          My blunders ({customPuzzles.length})
        </button>
        <button
          role="tab"
          aria-selected={source === 'curated'}
          className={`btn ${source === 'curated' ? '' : 'secondary'}`}
          onClick={() => setSource('curated')}
        >
          Curated tactics ({curatedPuzzles.length})
        </button>
        {source !== 'daily' && username && solvedEver.size > 0 && (
          <span className="tag">
            {queue.filter((p) => solvedEver.has(puzzleRef(p))).length}/{queue.length} solved before
          </span>
        )}
        {source === 'curated' && chessComRating && (
          <span className="tag">Calibrated to your rating ({chessComRating})</span>
        )}
        {stats && (
          <span className="tag" style={{ marginLeft: 'auto' }}>
            {stats.solved}/{stats.attempted} solved lifetime
          </span>
        )}
      </div>

      {source === 'daily' && dailyPuzzles.length > 0 && (
        <div className="badge-row" role="group" aria-label="Today's puzzles" style={{ marginBottom: 18 }}>
          {dailyPuzzles.map((p, i) => {
            const solved = dailySolved.has(puzzleRef(p));
            return (
              <button
                key={puzzleRef(p)}
                onClick={() => setIndex(i)}
                className="tag"
                aria-current={i === index ? 'true' : undefined}
                aria-label={`Puzzle ${i + 1}${solved ? ', solved' : ''}${i === index ? ', current' : ''}`}
                style={{
                  cursor: 'pointer',
                  minWidth: 30,
                  minHeight: 28,
                  textAlign: 'center',
                  fontWeight: 700,
                  color: solved ? 'var(--win)' : i === index ? 'var(--text)' : 'var(--text-dim)',
                  borderColor: solved ? 'var(--win)' : i === index ? 'var(--text)' : 'var(--border)',
                }}
              >
                {solved ? '✓' : i + 1}
              </button>
            );
          })}
        </div>
      )}

      {error && <div className="card error-banner" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {source === 'daily' && !username && (
        <div className="empty-state card">Connect your chess.com account on the Dashboard to get a personalized daily plan.</div>
      )}

      {source === 'daily' && username && dailyComplete && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'var(--accent)' }}>
          <p style={{ margin: 0 }}>
            <strong className="classification-best">Daily 10 complete!</strong> Nice work — come back tomorrow for a fresh set.
            You can still replay any of today's puzzles below.
          </p>
        </div>
      )}

      {!puzzle && source !== 'daily' && (
        <div className="empty-state card">
          {source === 'mine'
            ? 'No custom puzzles yet — analyze a game and save a blunder to get started.'
            : 'No curated puzzles available.'}
        </div>
      )}

      {puzzle && chess && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,460px) 1fr', gap: 24 }}>
          <div>
            <Chessboard
              options={{
                position: chess.fen(),
                boardOrientation,
                allowDrawingArrows: true,
                ...interactionOptions,
              }}
            />
            <p style={{ textAlign: 'center', marginTop: 8, fontSize: '0.9rem' }}>
              Click or drag a piece to move · right-click drag to draw arrows
            </p>

            {mistakeContext && (
              <div className="card" style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: '1rem' }}>What you actually played</h3>
                <p className="text-small" style={{ marginBottom: 10 }}>
                  In your real game{mistakeContext.opponent ? ` against ${mistakeContext.opponent}` : ''}, you played{' '}
                  <strong className="classification-blunder">{mistakeContext.moveSan}</strong> here instead. See if you can find
                  the better move on the left.
                </p>
                <div style={{ maxWidth: 260, margin: '0 auto' }}>
                  <Chessboard
                    options={{
                      position: mistakeContext.fenAfter,
                      boardOrientation,
                      allowDragging: false,
                      id: 'mistake-context-board',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="card">
            <h3>{puzzle.theme?.replace(/-/g, ' ') || 'Tactic'}</h3>
            <p>Find the best move for {boardOrientation === 'white' ? 'White' : 'Black'}.</p>
            {alreadySolved && status === 'playing' && (
              <p className="text-small classification-best" style={{ marginTop: -8 }}>
                You've solved this one before — see if you can find it again.
              </p>
            )}

            <div role="status" aria-live="polite">
              {status === 'wrong' && <p className="classification-blunder">Not quite — try again.</p>}
              {status === 'correct' && <p className="classification-best">Solved! Well done.</p>}
            </div>

            {(explaining || explanation) && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 4, marginBottom: 4 }}>
                <CoachAvatar size={32} />
                <div style={{ fontSize: '0.95rem', lineHeight: 1.6, fontStyle: 'italic' }}>
                  {explaining && !explanation && <p style={{ margin: 0, color: 'var(--text-dim)' }}>Thinking it through…</p>}
                  {explanation?.why && (
                    <p style={{ margin: '0 0 8px' }}>&ldquo;{explanation.why}&rdquo;</p>
                  )}
                  {explanation?.solutionWhy && (
                    <p style={{ margin: 0, color: status === 'correct' ? undefined : 'var(--text-dim)' }}>
                      &ldquo;<strong style={{ color: 'var(--text)' }}>
                        {status === 'correct' ? 'Why that worked:' : 'The answer:'}
                      </strong>{' '}
                      {explanation.solutionWhy}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn secondary" onClick={nextPuzzle}>Skip / Next puzzle</button>
              {status === 'playing' && !explanation && (
                <button className="btn secondary" onClick={revealAnswer} disabled={explaining}>
                  Show answer &amp; why
                </button>
              )}
              {status === 'correct' && <button className="btn" onClick={nextPuzzle}>Next puzzle →</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

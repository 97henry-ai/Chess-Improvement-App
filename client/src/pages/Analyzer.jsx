import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';
import { analyzeFen } from '../engine/stockfishClient.js';
import { evalToCp, classifyMove } from '../engine/classify.js';
import { useChessInteraction } from '../engine/useChessInteraction.js';

const EMPTY_CHESS = new Chess();

function buildPlies(pgn) {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return [];
  }
  const history = chess.history({ verbose: true });
  const replay = new Chess();
  const plies = [];
  history.forEach((move, i) => {
    const fenBefore = replay.fen();
    replay.move(move.san);
    const fenAfter = replay.fen();
    plies.push({
      ply: i + 1,
      san: move.san,
      from: move.from,
      to: move.to,
      color: move.color,
      fenBefore,
      fenAfter,
      isCheckmateAfter: replay.isCheckmate(),
    });
  });
  return plies;
}

function uciToSan(fen, uciMove) {
  if (!uciMove || uciMove.length < 4) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uciMove.slice(0, 2),
      to: uciMove.slice(2, 4),
      promotion: uciMove.length > 4 ? uciMove[4] : undefined,
    });
    return move?.san || null;
  } catch {
    return null;
  }
}

/** Replay a sequence of UCI moves from a FEN, converting each to SAN, stopping at the first illegal move. */
function pvToSanLine(fen, uciMoves = [], maxPlies = 4) {
  const chess = new Chess(fen);
  const sans = [];
  for (const uci of uciMoves.slice(0, maxPlies)) {
    if (!uci || uci.length < 4) break;
    let move;
    try {
      move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    } catch {
      move = null;
    }
    if (!move) break;
    sans.push(move.san);
  }
  return sans;
}

/** Is this a simple pawn push (not a capture/promotion) on a file next to the mover's own king? */
function isPawnPushNearOwnKing(ply) {
  const trimmed = ply.san.replace('+', '').replace('#', '');
  if (!/^[a-h][1-8]$/.test(trimmed)) return false;
  try {
    const chess = new Chess(ply.fenBefore);
    let kingSquare = null;
    for (const row of chess.board()) {
      for (const sq of row) {
        if (sq && sq.type === 'k' && sq.color === ply.color) kingSquare = sq.square;
      }
    }
    if (!kingSquare) return false;
    return Math.abs(trimmed.charCodeAt(0) - kingSquare.charCodeAt(0)) <= 1;
  } catch {
    return false;
  }
}

/**
 * Build a simple, plain-language breakdown of why a move fell short: what
 * went wrong, the better move, and a general habit that prevents this same
 * kind of mistake next time — not just a raw evaluation number.
 */
function explainMove(ply) {
  if (!ply.classification || ply.classification === 'best' || ply.classification === 'good') return null;

  const alternatives = (ply.alternatives || []).filter((a) => a.san && a.san !== ply.san);
  const better = alternatives[0]?.san || null;
  const refutation = ply.refutationSan || [];
  const punishingMove = refutation[0] || null;

  let why;
  let tip;

  if (ply.refutationIsMate) {
    why = `${ply.san} allows your opponent to force checkmate${punishingMove ? ` starting with ${punishingMove}` : ''}.`;
    tip = 'When your king is exposed, double-check for forced sequences before playing a natural-looking move — a "safe-looking" move can still walk into a forced mate.';
  } else if (punishingMove?.includes('x')) {
    why = `${ply.san} leaves a piece where your opponent can simply capture it with ${punishingMove}.`;
    tip = 'Before you move, check every piece you have — including the one you\'re about to move — and ask "can anything take this for free?"';
  } else if (refutation.some((m) => m.includes('+'))) {
    why = `${ply.san} gives your opponent a strong check${punishingMove ? ` (${punishingMove})` : ''} that seizes the initiative.`;
    tip = "Before playing a quiet move, scan for every check your opponent could give next — checks are forcing and easy to overlook.";
  } else if (isPawnPushNearOwnKing(ply)) {
    why = `${ply.san} pushes a pawn near your own king, permanently weakening the squares it used to guard.`;
    tip = "Avoid pushing pawns in front of your own king unless you have a clear reason — those squares can never be defended by a pawn again.";
  } else if (ply.evalLoss >= 600) {
    why = `${ply.san} leads to a much worse position for you, even though it doesn't lose material outright.`;
    tip = 'When a move looks fine on the surface, calculate 2-3 moves ahead to see how your opponent responds before committing to it.';
  } else {
    why = better
      ? `${ply.san} is playable, but ${better} does more — it improves your position or restricts your opponent more effectively.`
      : `${ply.san} is not the strongest option here.`;
    tip = 'When no tactic is available, prefer moves that improve your worst-placed piece or increase control of the center.';
  }

  return { why, better, tip };
}

function ExplanationBlock({ ply, compact }) {
  const explanation = explainMove(ply);
  if (!explanation) return null;
  const size = compact ? '0.92rem' : '0.98rem';
  return (
    <div style={{ fontSize: size, lineHeight: 1.6 }}>
      <p style={{ margin: '0 0 8px' }}>{explanation.why}</p>
      {explanation.better && (
        <p style={{ margin: '0 0 8px' }}>
          <strong>Better move:</strong> {explanation.better}
        </p>
      )}
      <p style={{ margin: 0, color: 'var(--text-dim)' }}>
        <strong style={{ color: 'var(--text)' }}>How to avoid this:</strong> {explanation.tip}
      </p>
    </div>
  );
}

function evalLabel(evaluation) {
  if (!evaluation) return '…';
  if (evaluation.mate !== undefined) return `#${evaluation.mate}`;
  return (evaluation.cp / 100).toFixed(2);
}

function evalBarHeight(evaluation) {
  const cp = evalToCp(evaluation);
  const clamped = Math.max(-1000, Math.min(1000, cp));
  return 50 + (clamped / 1000) * 50; // percent height for white's bar, from bottom
}

export default function Analyzer() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { username } = useUser();

  const [games, setGames] = useState([]);
  const [game, setGame] = useState(null);
  const [plies, setPlies] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [savedPuzzleIds, setSavedPuzzleIds] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    if (username && !gameId) {
      api.getGames(username, 25).then(setGames).catch((e) => setError(e.message));
    }
  }, [username, gameId]);

  useEffect(() => {
    if (!gameId) return;
    setError('');
    api
      .getGameDetail(gameId)
      .then((g) => {
        setGame(g);
        const builtPlies = buildPlies(g.pgn);
        if (g.moves?.length) {
          const byPly = new Map(g.moves.map((m) => [m.ply, m]));
          builtPlies.forEach((p) => {
            const saved = byPly.get(p.ply);
            if (saved) {
              p.evalBefore = saved.eval_before;
              p.evalAfter = saved.eval_after;
              p.evalLoss = saved.eval_loss;
              p.classification = saved.classification;
              p.bestMoveSan = saved.best_move_san;
            }
          });
        }
        setPlies(builtPlies);
        setCursor(0);
      })
      .catch((e) => setError(e.message));
  }, [gameId]);

  const currentFen = plies.length ? (cursor === 0 ? plies[0].fenBefore : plies[cursor - 1].fenAfter) : 'start';
  const currentPly = plies[cursor];

  const [explorationChess, setExplorationChess] = useState(null);
  const { options: interactionOptions, reset: resetInteraction, setLastMove } = useChessInteraction({
    chess: explorationChess || EMPTY_CHESS,
    disabled: !explorationChess,
  });

  useEffect(() => {
    if (currentFen === 'start') {
      setExplorationChess(null);
      return;
    }
    setExplorationChess(new Chess(currentFen));
    resetInteraction();
    const viewedMove = cursor > 0 ? plies[cursor - 1] : null;
    if (viewedMove?.from && viewedMove?.to) {
      setLastMove({ from: viewedMove.from, to: viewedMove.to });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFen]);

  const isExploring = explorationChess && explorationChess.fen().split(' ')[0] !== currentFen.split(' ')[0];

  function resetToGamePosition() {
    if (currentFen === 'start') return;
    setExplorationChess(new Chess(currentFen));
    resetInteraction();
    const viewedMove = cursor > 0 ? plies[cursor - 1] : null;
    if (viewedMove?.from && viewedMove?.to) {
      setLastMove({ from: viewedMove.from, to: viewedMove.to });
    }
  }

  async function runFullAnalysis() {
    if (!plies.length) return;
    setAnalyzing(true);
    setProgress(0);
    const results = [];
    for (let i = 0; i < plies.length; i++) {
      const p = plies[i];
      const before = await analyzeFen(p.fenBefore, { depth: 12, multipv: 3 });
      const alternatives = (before.lines || []).map((line) => ({
        san: uciToSan(p.fenBefore, line.pv?.[0]),
        evalCp: evalToCp(line.evaluation),
      }));
      const evalBeforeCp = evalToCp(before.evaluation);

      let enriched;
      if (p.isCheckmateAfter) {
        // A position with no legal replies has no engine score to compare against —
        // delivering checkmate is always the best possible outcome, full stop.
        enriched = {
          ...p,
          evalBefore: evalBeforeCp,
          evalAfter: evalBeforeCp,
          evalLoss: 0,
          classification: 'best',
          bestMoveSan: p.san,
          alternatives,
          refutationSan: [],
          refutationIsMate: false,
        };
      } else {
        const after = await analyzeFen(p.fenAfter, { depth: 12 });
        const evalAfterCp = evalToCp(after.evaluation);
        const { loss, classification } = classifyMove(evalBeforeCp, evalAfterCp, p.color);
        enriched = {
          ...p,
          evalBefore: evalBeforeCp,
          evalAfter: evalAfterCp,
          evalLoss: loss,
          classification,
          bestMoveSan: alternatives[0]?.san ?? uciToSan(p.fenBefore, before.pv?.[0]),
          alternatives,
          refutationSan: loss >= 50 ? pvToSanLine(p.fenAfter, after.pv, 4) : [],
          refutationIsMate: loss >= 50 && after.evaluation?.mate !== undefined,
        };
      }
      results.push(enriched);
      setProgress(Math.round(((i + 1) / plies.length) * 100));
    }
    setPlies(results);
    setAnalyzing(false);

    if (game?.id) {
      api
        .saveGameAnalysis(
          game.id,
          results.map((r) => ({
            ply: r.ply,
            move_san: r.san,
            fen_before: r.fenBefore,
            fen_after: r.fenAfter,
            eval_before: r.evalBefore,
            eval_after: r.evalAfter,
            eval_loss: r.evalLoss,
            classification: r.classification,
            best_move_san: r.bestMoveSan,
          }))
        )
        .catch(() => {});
    }
  }

  async function saveAsPuzzle(ply) {
    if (!username) return;
    try {
      // Use the rating the player actually held in this game, so the puzzle's
      // difficulty label matches their real level rather than a guess.
      const playerRating = game?.player_color === 'white' ? game?.white_rating : game?.black_rating;
      const saved = await api.saveCustomPuzzle(username, {
        fen: ply.fenBefore,
        solution_san: [ply.bestMoveSan || ply.san],
        theme: `blunder-${ply.color === 'w' ? 'white' : 'black'}`,
        eval_loss: ply.evalLoss,
        game_id: game?.id,
        rating: playerRating || 1200,
      });
      setSavedPuzzleIds((prev) => ({ ...prev, [ply.ply]: saved.id }));
    } catch (e) {
      setError(e.message);
    }
  }

  const blunders = useMemo(() => plies.filter((p) => p.classification === 'blunder' || p.classification === 'mistake'), [plies]);

  if (!gameId) {
    return (
      <div>
        <h1>Game Analyzer</h1>
        <p>Pick a game to run a full Stockfish analysis, review your mistakes, and save them as custom puzzles.</p>
        {!username && <div className="empty-state card">Connect your chess.com account on the Dashboard first.</div>}
        <ul className="list-plain">
          {games.map((g) => (
            <li key={g.id} className="move-row card" style={{ marginBottom: 6 }} onClick={() => navigate(`/analyzer/${g.id}`)}>
              <span>
                <strong>{g.white}</strong> ({g.white_rating}) vs <strong>{g.black}</strong> ({g.black_rating}) · {g.time_class} ·{' '}
                {g.opening_name || 'Unknown opening'}
              </span>
              <span className={`tag ${g.player_result}`}>{g.player_result}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <button className="btn secondary" onClick={() => navigate('/analyzer')} style={{ marginBottom: 16 }}>
        ← All games
      </button>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}>{error}</div>}
      {!game ? (
        <p>Loading game…</p>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.05rem' }}>
                <span aria-hidden style={{ fontSize: '1.1rem' }}>♔</span>
                <strong>{game.white || 'White'}</strong>
                {game.white_rating && <span className="tag">{game.white_rating}</span>}
                {game.player_color === 'white' && <span className="tag win">you</span>}
              </div>
              <span style={{ color: 'var(--text-dim)' }}>vs</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.05rem' }}>
                <span aria-hidden style={{ fontSize: '1.1rem' }}>♚</span>
                <strong>{game.black || 'Black'}</strong>
                {game.black_rating && <span className="tag">{game.black_rating}</span>}
                {game.player_color === 'black' && <span className="tag win">you</span>}
              </div>
              <span className={`tag ${game.player_result}`} style={{ marginLeft: 'auto' }}>
                {game.player_result === 'win' ? 'You won' : game.player_result === 'loss' ? 'You lost' : 'Draw'}
              </span>
            </div>
            <div className="badge-row" style={{ marginTop: 10, marginBottom: 0 }}>
              {game.time_class && <span className="tag">{game.time_class}</span>}
              {game.opening_name && <span className="tag">{game.opening_name}</span>}
              {game.end_time && <span className="tag">{new Date(game.end_time * 1000).toLocaleDateString()}</span>}
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: '52px minmax(0,460px) 1fr', gap: 20, alignItems: 'start' }}>
          <div>
            <div className="eval-bar-wrap" style={{ height: 460 }}>
              <div className="eval-bar-fill" style={{ height: `${evalBarHeight(currentPly?.evalAfter !== undefined ? { cp: currentPly.evalAfter } : null)}%` }} />
            </div>
            {currentPly?.evalAfter !== undefined && (
              <div style={{ textAlign: 'center', marginTop: 6, fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                {evalLabel({ cp: currentPly.evalAfter })}
              </div>
            )}
          </div>

          <div>
            <Chessboard
              options={{
                position: explorationChess ? explorationChess.fen() : currentFen === 'start' ? undefined : currentFen,
                boardOrientation: game.player_color === 'black' ? 'black' : 'white',
                allowDrawingArrows: true,
                ...interactionOptions,
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
              <button className="btn secondary" onClick={() => setCursor(0)} disabled={cursor === 0}>⏮</button>
              <button className="btn secondary" onClick={() => setCursor((c) => Math.max(0, c - 1))} disabled={cursor === 0}>◀</button>
              <button className="btn secondary" onClick={() => setCursor((c) => Math.min(plies.length, c + 1))} disabled={cursor >= plies.length}>▶</button>
              <button className="btn secondary" onClick={() => setCursor(plies.length)} disabled={cursor >= plies.length}>⏭</button>
            </div>
            {isExploring ? (
              <p style={{ textAlign: 'center', marginTop: 8, fontSize: '0.9rem' }}>
                Exploring a variation — not part of the game.{' '}
                <button className="btn secondary" style={{ padding: '3px 12px', fontSize: '0.85rem' }} onClick={resetToGamePosition}>
                  Reset to game
                </button>
              </p>
            ) : (
              <p style={{ textAlign: 'center', marginTop: 8, fontSize: '0.9rem' }}>
                Drag or click pieces to explore variations from here
              </p>
            )}
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Analysis</h3>
              <button className="btn" onClick={runFullAnalysis} disabled={analyzing}>
                {analyzing ? `Analyzing… ${progress}%` : 'Run Stockfish analysis'}
              </button>
            </div>

            {currentPly && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ marginBottom: currentPly.classification ? 6 : 0 }}>
                  Move {Math.ceil(currentPly.ply / 2)}
                  {currentPly.color === 'w' ? '.' : '...'} <strong>{currentPly.san}</strong>
                  {currentPly.classification && (
                    <> — <span className={`classification-${currentPly.classification}`}>{currentPly.classification}</span></>
                  )}
                </p>
                {currentPly.classification === 'best' || currentPly.classification === 'good' ? (
                  <p style={{ fontSize: '0.95rem' }} className="classification-best">
                    {currentPly.classification === 'best' ? 'This was the engine\'s top choice.' : 'A strong move — close to the engine\'s top choice.'}
                  </p>
                ) : (
                  <ExplanationBlock ply={currentPly} />
                )}
              </div>
            )}

            <h3 style={{ marginTop: 18 }}>Move list</h3>
            <ul className="list-plain" style={{ maxHeight: 220, overflowY: 'auto' }}>
              {plies.map((p, i) => (
                <li
                  key={p.ply}
                  className={`move-row ${cursor === i + 1 ? 'active' : ''}`}
                  onClick={() => setCursor(i + 1)}
                >
                  <span>
                    {p.color === 'w' ? `${Math.ceil(p.ply / 2)}.` : ''} {p.san}
                  </span>
                  {p.classification && <span className={`classification-${p.classification}`}>{p.classification}</span>}
                </li>
              ))}
            </ul>

            <h3 style={{ marginTop: 18 }}>Mistakes to fix ({blunders.length})</h3>
            {blunders.length === 0 && <p>Run analysis to detect blunders and mistakes.</p>}
            <ul className="list-plain">
              {blunders.map((p) => (
                <li
                  key={p.ply}
                  className={`move-row ${cursor === p.ply ? 'active' : ''}`}
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, cursor: 'pointer' }}
                  onClick={() => setCursor(p.ply)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      Move {Math.ceil(p.ply / 2)} <strong>{p.san}</strong>{' '}
                      <span className={`classification-${p.classification}`}>({p.classification})</span>
                    </span>
                    <button
                      className="btn secondary"
                      style={{ padding: '5px 12px', fontSize: '0.85rem' }}
                      disabled={!!savedPuzzleIds[p.ply]}
                      onClick={(e) => { e.stopPropagation(); saveAsPuzzle(p); }}
                    >
                      {savedPuzzleIds[p.ply] ? 'Saved ✓' : 'Save as puzzle'}
                    </button>
                  </div>
                  <ExplanationBlock ply={p} compact />
                </li>
              ))}
            </ul>
          </div>
        </div>
        </>
      )}
    </div>
  );
}

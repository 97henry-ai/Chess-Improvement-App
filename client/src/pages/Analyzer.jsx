import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';
import { analyzeFen } from '../engine/stockfishClient.js';
import { evalToCp, classifyMove } from '../engine/classify.js';
import { useChessInteraction } from '../engine/useChessInteraction.js';
import CoachAvatar from '../components/CoachAvatar.jsx';
import { acplLevel } from '../accuracyLabel.js';

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

const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// A handful of honest, low-content fallback phrasings for moves that don't do
// anything dramatic — picked deterministically per move (not randomly) so the
// same move always reads the same way, but different quiet moves don't all
// repeat the exact same sentence.
const QUIET_MOVE_FALLBACKS = [
  'keeps the position flexible without committing too early',
  'quietly improves piece coordination',
  'maintains a solid, active setup',
  "doesn't create a weakness while keeping options open",
];

/** A specific, move-aware reason a candidate move is good — based on what it actually does on the board. */
function describeWhyGood(fenBefore, san) {
  try {
    const chess = new Chess(fenBefore);
    const move = chess.move(san);
    if (!move) return 'is a reasonable practical choice here';
    if (chess.isCheckmate()) return 'delivers checkmate';
    if (move.captured) return `wins the ${PIECE_NAMES[move.captured] || 'piece'}`;
    if (chess.isCheck()) return 'gives a strong check, keeping the initiative';
    if (move.flags.includes('k') || move.flags.includes('q')) return "gets the king to safety and connects the rooks";
    if (move.flags.includes('p')) return 'promotes the pawn to a new queen';
    if (move.piece === 'p' && ['d4', 'd5', 'e4', 'e5'].includes(move.to)) return 'stakes a claim in the center';
    const backRank = move.color === 'w' ? '1' : '8';
    if ((move.piece === 'n' || move.piece === 'b') && move.from[1] === backRank) return 'develops a piece toward the action';
    if (move.piece === 'q' && move.from[1] === backRank) return 'brings the queen into play';
    if (move.piece === 'r') return "improves the rook's reach";
    const idx = (san.charCodeAt(0) + san.length + (move.to?.charCodeAt(0) || 0)) % QUIET_MOVE_FALLBACKS.length;
    return QUIET_MOVE_FALLBACKS[idx];
  } catch {
    return 'is a reasonable practical choice here';
  }
}

function formatMoverEval(evalCp, moverColor) {
  const cp = moverColor === 'w' ? evalCp : -evalCp;
  const pawns = (cp / 100).toFixed(1);
  return cp >= 0 ? `+${pawns}` : pawns;
}

function OtherGoodMoves({ ply, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const played = ply.san;
  const options = (ply.alternatives || []).filter((a) => a.san && a.san !== played).slice(0, 3);
  if (options.length === 0) return null;
  if (!open) {
    return (
      <button
        className="btn secondary"
        style={{ padding: '4px 12px', fontSize: '0.82rem', marginTop: 4 }}
        onClick={() => setOpen(true)}
      >
        Show {options.length} other good option{options.length === 1 ? '' : 's'}
      </button>
    );
  }
  return (
    <div style={{ marginTop: 4 }}>
      <p className="text-small" style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--text)' }}>
        A few other strong options here:
      </p>
      <ul className="list-plain" style={{ gap: 2 }}>
        {options.map((alt, i) => (
          <li key={alt.san} style={{ padding: '2px 0', fontFamily: 'var(--font-mono)', fontSize: '0.88rem' }}>
            <strong className={i === 0 ? 'classification-best' : ''}>{alt.san}</strong>{' '}
            <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-sans)' }}>
              ({formatMoverEval(alt.evalCp, ply.color)}) — {describeWhyGood(ply.fenBefore, alt.san)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExplanationBlock({ ply, compact }) {
  const explanation = explainMove(ply);
  const [showMore, setShowMore] = useState(false);
  if (!explanation) return null;
  const size = compact ? '0.92rem' : '0.98rem';
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <CoachAvatar size={compact ? 26 : 32} />
      <div style={{ fontSize: size, lineHeight: 1.6, fontStyle: 'italic' }}>
        <p style={{ margin: '0 0 8px' }}>&ldquo;{explanation.why}&rdquo;</p>
        {explanation.better && (
          <p style={{ margin: '0 0 8px' }}>
            &ldquo;<strong>Better:</strong> {explanation.better} — {describeWhyGood(ply.fenBefore, explanation.better)}&rdquo;
          </p>
        )}
        <div style={{ fontStyle: 'normal' }}>
          {showMore ? (
            <>
              <p style={{ margin: '0 0 4px', color: 'var(--text-dim)' }}>
                &ldquo;<strong style={{ color: 'var(--text)' }}>How to avoid this:</strong> {explanation.tip}&rdquo;
              </p>
              <OtherGoodMoves ply={ply} defaultOpen />
            </>
          ) : (
            <button
              className="btn secondary"
              style={{ padding: '4px 12px', fontSize: '0.82rem' }}
              onClick={() => setShowMore(true)}
            >
              Show more detail
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Summarize the whole game from the connected player's side only: how many
 * best/good/inaccurate/mistaken/blundered moves they made, an approximate
 * accuracy %, and a coach-style quote calling out the single costliest moment.
 */
function buildGameSummary(plies, playerColor) {
  const moverColor = playerColor === 'black' ? 'b' : 'w';
  const own = plies.filter((p) => p.color === moverColor && p.classification);
  if (own.length === 0) return null;

  const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  let lossSum = 0;
  let worst = null;
  for (const p of own) {
    counts[p.classification] = (counts[p.classification] || 0) + 1;
    lossSum += Math.min(p.evalLoss || 0, 1000);
    if (!worst || (p.evalLoss || 0) > (worst.evalLoss || 0)) worst = p;
  }
  const acpl = Math.round(lossSum / own.length);
  const goodMovePct = Math.round(((counts.best + counts.good) / own.length) * 100);

  let verdict;
  if (acpl <= 25) verdict = 'a very clean, precise game';
  else if (acpl <= 50) verdict = 'a solid game with only small slips';
  else if (acpl <= 90) verdict = 'a game with a few costly moments';
  else verdict = 'a game with some big swings — good material to learn from';

  let quote = `That was ${verdict}. `;
  if (counts.blunder > 0) {
    quote += `You had ${counts.blunder} blunder${counts.blunder === 1 ? '' : 's'}`;
    if (counts.mistake > 0) quote += ` and ${counts.mistake} mistake${counts.mistake === 1 ? '' : 's'}`;
    quote += '. ';
  } else if (counts.mistake > 0) {
    quote += `You had ${counts.mistake} mistake${counts.mistake === 1 ? '' : 's'}, nothing too serious. `;
  } else {
    quote += 'Nice and steady from you. ';
  }
  if (worst && (worst.evalLoss || 0) >= 100) {
    quote += `The critical moment was ${worst.san} on move ${Math.ceil(worst.ply / 2)} — look at that one first.`;
  } else {
    quote += 'Keep building on this.';
  }

  return { counts, acpl, goodMovePct, worst, quote };
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
  const [mistakeIndex, setMistakeIndex] = useState(0);

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
  // The board shows the position AFTER `cursor` moves have been played, so the
  // analysis panel must describe the move that got us there (plies[cursor - 1]),
  // not the upcoming one (plies[cursor]) — otherwise the text/eval describes a
  // move that hasn't happened on the board yet.
  const currentPly = cursor > 0 ? plies[cursor - 1] : null;
  // Eval that matches whatever position is currently on the board: the eval
  // after the last-played move, or the starting position's eval at cursor 0.
  const displayEvalCp = currentPly ? currentPly.evalAfter : plies[0]?.evalBefore;

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

  // Only the connected player's own mistakes — this section is "yours to fix",
  // not a list of the opponent's errors mixed in with pronouns that assume you made them.
  const blunders = useMemo(() => {
    const moverColor = game?.player_color === 'black' ? 'b' : 'w';
    return plies.filter((p) => (p.classification === 'blunder' || p.classification === 'mistake') && p.color === moverColor);
  }, [plies, game]);
  useEffect(() => {
    setMistakeIndex(0);
  }, [blunders.length, gameId]);
  const currentMistake = blunders[mistakeIndex];
  const gameSummary = useMemo(() => (game ? buildGameSummary(plies, game.player_color) : null), [plies, game]);
  const playerMoveColor = game?.player_color === 'black' ? 'b' : 'w';
  const opponentName = game ? (game.player_color === 'white' ? game.black : game.white) || 'your opponent' : 'your opponent';
  const consistency = gameSummary ? acplLevel(gameSummary.acpl) : null;
  const consistencyClass = consistency
    ? consistency.tone === 'win' ? 'best' : consistency.tone === 'loss' ? 'blunder' : consistency.tone === 'draw' ? 'mistake' : 'good'
    : 'good';
  const movePairs = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < plies.length; i += 2) {
      pairs.push({ num: Math.ceil((i + 1) / 2), white: plies[i], black: plies[i + 1] });
    }
    return pairs;
  }, [plies]);

  if (!gameId) {
    return (
      <div>
        <h1>Game Analyzer</h1>
        <p>Pick a game to run a full Stockfish analysis, review your mistakes, and save them as custom puzzles.</p>
        {!username && <div className="empty-state card">Connect your chess.com account on the Dashboard first.</div>}
        {error && <div className="card error-banner" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
        <ul className="list-plain">
          {games.map((g) => (
            <li key={g.id} className="move-row card" style={{ marginBottom: 6, padding: 0 }}>
              <button
                type="button"
                onClick={() => navigate(`/analyzer/${g.id}`)}
                style={{
                  all: 'unset',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  padding: '9px 12px',
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                }}
              >
                <span>
                  <strong>{g.white}</strong> ({g.white_rating}) vs <strong>{g.black}</strong> ({g.black_rating}) · {g.time_class} ·{' '}
                  {g.opening_name || 'Unknown opening'}
                </span>
                <span className={`tag ${g.player_result}`}>{g.player_result}</span>
              </button>
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
      {error && <div className="card error-banner" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
      {!game ? (
        <p role="status" aria-live="polite">Loading game…</p>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Side</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Player</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Rating</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Role</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={game.player_color === 'white' ? { background: 'var(--bg-elevated)' } : undefined}>
                    <td style={{ padding: '6px 8px' }}><span aria-hidden="true">♔</span> White</td>
                    <td style={{ padding: '6px 8px' }}><strong>{game.white || 'White'}</strong></td>
                    <td style={{ padding: '6px 8px' }}>{game.white_rating ?? '—'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {game.player_color === 'white' ? <span className="tag win">You</span> : <span className="tag">Opponent</span>}
                    </td>
                  </tr>
                  <tr style={game.player_color === 'black' ? { background: 'var(--bg-elevated)' } : undefined}>
                    <td style={{ padding: '6px 8px' }}><span aria-hidden="true">♚</span> Black</td>
                    <td style={{ padding: '6px 8px' }}><strong>{game.black || 'Black'}</strong></td>
                    <td style={{ padding: '6px 8px' }}>{game.black_rating ?? '—'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {game.player_color === 'black' ? <span className="tag win">You</span> : <span className="tag">Opponent</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10 }}>
              <span className={`tag ${game.player_result}`}>
                {game.player_result === 'win' ? 'You won' : game.player_result === 'loss' ? 'You lost' : 'Draw'}
              </span>
            </div>
            <div className="badge-row" style={{ marginTop: 10, marginBottom: 0 }}>
              {game.time_class && <span className="tag">{game.time_class}</span>}
              {game.opening_name && <span className="tag">{game.opening_name}</span>}
              {game.end_time && <span className="tag">{new Date(game.end_time * 1000).toLocaleDateString()}</span>}
            </div>
          </div>

          {gameSummary && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <CoachAvatar size={64} />
                <div style={{ flex: 1, minWidth: 240 }}>
                  <h3 style={{ marginBottom: 8 }}>Coach's summary</h3>
                  <blockquote
                    style={{
                      margin: 0,
                      fontStyle: 'italic',
                      fontSize: '1.02rem',
                      lineHeight: 1.6,
                      borderLeft: '3px solid var(--accent)',
                      paddingLeft: 14,
                    }}
                  >
                    &ldquo;{gameSummary.quote}&rdquo;
                  </blockquote>
                </div>
              </div>
              <div className="grid grid-4" style={{ marginTop: 18 }}>
                <div className="stat-tile">
                  <div className="value">{gameSummary.goodMovePct}%</div>
                  <div className="label">Best/good moves</div>
                </div>
                <div className="stat-tile">
                  <div className={`value classification-${consistencyClass}`}>{consistency.label}</div>
                  <div className="label">Consistency</div>
                </div>
                <div className="stat-tile">
                  <div className="value classification-mistake">{gameSummary.counts.mistake}</div>
                  <div className="label">Mistakes</div>
                </div>
                <div className="stat-tile">
                  <div className="value classification-blunder">{gameSummary.counts.blunder}</div>
                  <div className="label">Blunders</div>
                </div>
              </div>
            </div>
          )}

          <div className="grid" style={{ gridTemplateColumns: '52px minmax(0,460px) 1fr', gap: 20, alignItems: 'start' }}>
          <div>
            <div className="eval-bar-wrap" style={{ height: 460 }}>
              <div className="eval-bar-fill" style={{ height: `${evalBarHeight(displayEvalCp !== undefined ? { cp: displayEvalCp } : null)}%` }} />
            </div>
            {displayEvalCp !== undefined && (
              <div style={{ textAlign: 'center', marginTop: 6, fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                {evalLabel({ cp: displayEvalCp })}
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
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }} role="group" aria-label="Move navigation">
              <button className="btn secondary" aria-label="Go to start of game" onClick={() => setCursor(0)} disabled={cursor === 0}>
                <span aria-hidden="true">⏮</span>
              </button>
              <button className="btn secondary" aria-label="Previous move" onClick={() => setCursor((c) => Math.max(0, c - 1))} disabled={cursor === 0}>
                <span aria-hidden="true">◀</span>
              </button>
              <button className="btn secondary" aria-label="Next move" onClick={() => setCursor((c) => Math.min(plies.length, c + 1))} disabled={cursor >= plies.length}>
                <span aria-hidden="true">▶</span>
              </button>
              <button className="btn secondary" aria-label="Go to end of game" onClick={() => setCursor(plies.length)} disabled={cursor >= plies.length}>
                <span aria-hidden="true">⏭</span>
              </button>
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
              <button className="btn" onClick={runFullAnalysis} disabled={analyzing} aria-live="polite">
                {analyzing ? `Analyzing… ${progress}%` : 'Run Stockfish analysis'}
              </button>
            </div>

            {currentPly && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ marginBottom: currentPly.classification ? 6 : 0 }}>
                  Move {Math.ceil(currentPly.ply / 2)}
                  {currentPly.color === 'w' ? '.' : '...'} <strong>{currentPly.san}</strong>
                  {' '}
                  <span className="text-small">
                    ({currentPly.color === playerMoveColor ? 'you' : opponentName})
                  </span>
                  {currentPly.classification && (
                    <> — <span className={`classification-${currentPly.classification}`}>{currentPly.classification}</span></>
                  )}
                </p>
                {currentPly.classification === 'best' || currentPly.classification === 'good' ? (
                  <div>
                    <p style={{ fontSize: '0.95rem' }} className="classification-best">
                      {currentPly.color === playerMoveColor ? 'You' : opponentName} played the {currentPly.classification === 'best' ? "engine's top choice" : "engine's near-top choice"}
                      {' — '}
                      {describeWhyGood(currentPly.fenBefore, currentPly.san)}.
                    </p>
                    <OtherGoodMoves ply={currentPly} />
                  </div>
                ) : currentPly.color === playerMoveColor ? (
                  <ExplanationBlock ply={currentPly} />
                ) : (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <CoachAvatar size={32} />
                    <div style={{ fontSize: '0.92rem', lineHeight: 1.6, fontStyle: 'italic' }}>
                      <p style={{ margin: '0 0 8px' }}>
                        &ldquo;{opponentName}'s {currentPly.san} wasn't their strongest try here
                        {(currentPly.alternatives || []).find((a) => a.san !== currentPly.san)
                          ? ` — you could have made it harder for them.`
                          : '.'}
                        &rdquo;
                      </p>
                      <OtherGoodMoves ply={currentPly} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <h3 style={{ marginTop: 18 }}>Move list</h3>
            <div style={{ maxHeight: 260, overflowY: 'auto', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', position: 'sticky', top: 0, background: 'var(--bg-card)' }}>#</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', position: 'sticky', top: 0, background: 'var(--bg-card)' }}>White</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: '0.78rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', position: 'sticky', top: 0, background: 'var(--bg-card)' }}>Black</th>
                  </tr>
                </thead>
                <tbody>
                  {movePairs.map((pair) => (
                    <tr key={pair.num} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{pair.num}</td>
                      <td style={{ padding: '4px 4px' }}>
                        <button
                          onClick={() => setCursor(pair.white.ply)}
                          aria-current={cursor === pair.white.ply ? 'true' : undefined}
                          aria-label={`Move ${pair.num}. ${pair.white.san}${pair.white.classification ? `, ${pair.white.classification}` : ''}`}
                          className={`move-san-btn ${pair.white.classification ? `classification-${pair.white.classification}` : ''}`}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '100%',
                            background: cursor === pair.white.ply ? 'var(--bg-elevated)' : 'transparent',
                            border: cursor === pair.white.ply ? '1px solid var(--accent)' : '1px solid transparent',
                            borderRadius: 6,
                            padding: '4px 8px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.95rem',
                            cursor: 'pointer',
                            color: pair.white.classification ? undefined : 'var(--text)',
                          }}
                        >
                          {pair.white.san}
                        </button>
                      </td>
                      <td style={{ padding: '4px 4px' }}>
                        {pair.black && (
                          <button
                            onClick={() => setCursor(pair.black.ply)}
                            aria-current={cursor === pair.black.ply ? 'true' : undefined}
                            aria-label={`Move ${pair.num}... ${pair.black.san}${pair.black.classification ? `, ${pair.black.classification}` : ''}`}
                            className={`move-san-btn ${pair.black.classification ? `classification-${pair.black.classification}` : ''}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '100%',
                              background: cursor === pair.black.ply ? 'var(--bg-elevated)' : 'transparent',
                              border: cursor === pair.black.ply ? '1px solid var(--accent)' : '1px solid transparent',
                              borderRadius: 6,
                              padding: '4px 8px',
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.95rem',
                              cursor: 'pointer',
                              color: pair.black.classification ? undefined : 'var(--text)',
                            }}
                          >
                            {pair.black.san}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 style={{ marginTop: 18 }}>Your mistakes to fix ({blunders.length})</h3>
            {blunders.length === 0 && <p>Run analysis to detect blunders and mistakes.</p>}
            {currentMistake && (
              <div className="move-row active" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, cursor: 'default' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>
                    Move {Math.ceil(currentMistake.ply / 2)} <strong>{currentMistake.san}</strong>{' '}
                    <span className={`classification-${currentMistake.classification}`}>({currentMistake.classification})</span>
                  </span>
                  <button
                    className="btn secondary"
                    style={{ padding: '5px 12px', fontSize: '0.85rem' }}
                    disabled={!!savedPuzzleIds[currentMistake.ply]}
                    onClick={() => saveAsPuzzle(currentMistake)}
                  >
                    {savedPuzzleIds[currentMistake.ply] ? 'Saved ✓' : 'Save as puzzle'}
                  </button>
                </div>
                <ExplanationBlock ply={currentMistake} compact />
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 10, borderTop: '1px solid var(--border)' }}
                  role="group"
                  aria-label="Browse mistakes"
                >
                  <button
                    className="btn secondary"
                    aria-label="Previous mistake"
                    disabled={mistakeIndex === 0}
                    onClick={() => {
                      const next = mistakeIndex - 1;
                      setMistakeIndex(next);
                      setCursor(blunders[next].ply);
                    }}
                  >
                    <span aria-hidden="true">← Prev</span>
                  </button>
                  <span className="text-small">
                    Mistake {mistakeIndex + 1} of {blunders.length}
                  </span>
                  <button
                    className="btn secondary"
                    aria-label="Next mistake"
                    disabled={mistakeIndex >= blunders.length - 1}
                    onClick={() => {
                      const next = mistakeIndex + 1;
                      setMistakeIndex(next);
                      setCursor(blunders[next].ply);
                    }}
                  >
                    <span aria-hidden="true">Next →</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}

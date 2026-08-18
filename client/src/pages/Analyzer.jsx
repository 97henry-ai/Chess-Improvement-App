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
    plies.push({ ply: i + 1, san: move.san, from: move.from, to: move.to, color: move.color, fenBefore, fenAfter });
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
      const before = await analyzeFen(p.fenBefore, { depth: 12 });
      const after = await analyzeFen(p.fenAfter, { depth: 12 });
      const evalBeforeCp = evalToCp(before.evaluation);
      const evalAfterCp = evalToCp(after.evaluation);
      const { loss, classification } = classifyMove(evalBeforeCp, evalAfterCp, p.color);
      const enriched = {
        ...p,
        evalBefore: evalBeforeCp,
        evalAfter: evalAfterCp,
        evalLoss: loss,
        classification,
        bestMoveSan: uciToSan(p.fenBefore, before.pv?.[0]),
      };
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
      const saved = await api.saveCustomPuzzle(username, {
        fen: ply.fenBefore,
        solution_san: [ply.bestMoveSan || ply.san],
        theme: `blunder-${ply.color === 'w' ? 'white' : 'black'}`,
        eval_loss: ply.evalLoss,
        game_id: game?.id,
        rating: 1200,
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
                {g.player_color === 'white' ? 'White' : 'Black'} · {g.time_class} · {g.opening_name || 'Unknown opening'}
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
        <div className="grid" style={{ gridTemplateColumns: '52px minmax(0,460px) 1fr', gap: 20, alignItems: 'start' }}>
          <div>
            <div className="eval-bar-wrap" style={{ height: 460 }}>
              <div className="eval-bar-fill" style={{ height: `${evalBarHeight(currentPly?.evalAfter !== undefined ? { cp: currentPly.evalAfter } : null)}%` }} />
            </div>
            {currentPly?.evalAfter !== undefined && (
              <div style={{ textAlign: 'center', marginTop: 6, fontSize: '0.75rem', color: 'var(--text-dim)' }}>
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
              <p style={{ textAlign: 'center', marginTop: 8, fontSize: '0.8rem' }}>
                Exploring a variation — not part of the game.{' '}
                <button className="btn secondary" style={{ padding: '2px 10px', fontSize: '0.75rem' }} onClick={resetToGamePosition}>
                  Reset to game
                </button>
              </p>
            ) : (
              <p style={{ textAlign: 'center', marginTop: 8, fontSize: '0.8rem' }}>
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
              <p>
                Move {Math.ceil(currentPly.ply / 2)}
                {currentPly.color === 'w' ? '.' : '...'} <strong>{currentPly.san}</strong>
                {currentPly.classification && (
                  <> — <span className={`classification-${currentPly.classification}`}>{currentPly.classification}</span></>
                )}
                {currentPly.evalLoss > 20 && currentPly.bestMoveSan && (
                  <> (best was <strong>{currentPly.bestMoveSan}</strong>)</>
                )}
              </p>
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
                <li key={p.ply} className="move-row">
                  <span>
                    Move {Math.ceil(p.ply / 2)} <strong>{p.san}</strong>{' '}
                    <span className={`classification-${p.classification}`}>({p.classification})</span>
                  </span>
                  <button
                    className="btn secondary"
                    style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                    disabled={!!savedPuzzleIds[p.ply]}
                    onClick={() => saveAsPuzzle(p)}
                  >
                    {savedPuzzleIds[p.ply] ? 'Saved ✓' : 'Save as puzzle'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

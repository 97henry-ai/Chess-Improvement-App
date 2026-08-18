import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';
import { useChessInteraction } from '../engine/useChessInteraction.js';
import { playMoveSound } from '../engine/sound.js';
import { highestRating } from '../ratingUtils.js';

const EMPTY_CHESS = new Chess();

function normalizeSan(san) {
  return san?.replace('+', '').replace('#', '');
}

export default function Puzzles() {
  const { username } = useUser();
  const [source, setSource] = useState('mine'); // 'mine' | 'curated'
  const [customPuzzles, setCustomPuzzles] = useState([]);
  const [curatedPuzzles, setCuratedPuzzles] = useState([]);
  const [index, setIndex] = useState(0);
  const [chess, setChess] = useState(null);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState('playing'); // 'playing' | 'correct' | 'wrong'
  const [stats, setStats] = useState(null);
  const [chessComRating, setChessComRating] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (username) {
      api.getCustomPuzzles(username).then(setCustomPuzzles).catch((e) => setError(e.message));
      api.getPuzzleStats(username).then(setStats).catch(() => {});
      api
        .getStats(username)
        .then((s) => setChessComRating(highestRating(s)))
        .catch(() => setChessComRating(null));
    } else {
      setChessComRating(null);
    }
  }, [username]);

  useEffect(() => {
    api
      .getCuratedPuzzles(chessComRating ? { near: chessComRating } : {})
      .then(setCuratedPuzzles)
      .catch((e) => setError(e.message));
  }, [chessComRating]);

  const queue = source === 'mine' ? customPuzzles : curatedPuzzles;
  const puzzle = queue[index];

  const { options: interactionOptions, reset, setLastMove } = useChessInteraction({
    chess: chess || EMPTY_CHESS,
    disabled: !chess || !puzzle || status !== 'playing',
    onMoveMade: handleMoveMade,
  });

  useEffect(() => {
    if (puzzle) {
      setChess(new Chess(puzzle.fen));
      setStep(0);
      setStatus('playing');
      reset();
    } else {
      setChess(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle?.id]);

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

  function handleMoveMade(move) {
    if (!puzzle) return;
    const expected = normalizeSan(puzzle.solution_san[step]);
    if (normalizeSan(move.san) !== expected) {
      chess.undo();
      setStatus('wrong');
      playMoveSound('wrong');
      recordAttempt(false);
      return;
    }

    const nextStep = step + 1;
    if (nextStep >= puzzle.solution_san.length) {
      setStatus('correct');
      playMoveSound('success');
      recordAttempt(true);
      setStep(nextStep);
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
        }
      } catch {
        /* ignore malformed curated data */
      }
    }, 400);
  }

  function nextPuzzle() {
    setIndex((i) => (i + 1 < queue.length ? i + 1 : 0));
  }

  return (
    <div>
      <h1>Puzzle Trainer</h1>
      <p>Solve tactics pulled straight from your own blunders, or train with our curated puzzle set.</p>

      <div className="badge-row" style={{ marginBottom: 18 }}>
        <button className={`btn ${source === 'mine' ? '' : 'secondary'}`} onClick={() => { setSource('mine'); setIndex(0); }}>
          My blunders ({customPuzzles.length})
        </button>
        <button className={`btn ${source === 'curated' ? '' : 'secondary'}`} onClick={() => { setSource('curated'); setIndex(0); }}>
          Curated tactics ({curatedPuzzles.length})
        </button>
        {source === 'curated' && chessComRating && (
          <span className="tag">Calibrated to your rating ({chessComRating})</span>
        )}
        {stats && (
          <span className="tag" style={{ marginLeft: 'auto' }}>
            {stats.solved}/{stats.attempted} solved lifetime
          </span>
        )}
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}>{error}</div>}

      {!puzzle && (
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
            <p style={{ textAlign: 'center', marginTop: 8, fontSize: '0.8rem' }}>
              Click or drag a piece to move · right-click drag to draw arrows
            </p>
          </div>
          <div className="card">
            <h3>{puzzle.theme?.replace(/-/g, ' ') || 'Tactic'}</h3>
            <p>Find the best move for {boardOrientation === 'white' ? 'White' : 'Black'}.</p>

            {status === 'wrong' && <p className="classification-blunder">Not quite — try again.</p>}
            {status === 'correct' && <p className="classification-best">Solved! Well done.</p>}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn secondary" onClick={nextPuzzle}>Skip / Next puzzle</button>
              {status === 'correct' && <button className="btn" onClick={nextPuzzle}>Next puzzle →</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

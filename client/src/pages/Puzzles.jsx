import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useUser } from '../UserContext.jsx';
import { api } from '../api.js';

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
  const [error, setError] = useState('');

  useEffect(() => {
    if (username) {
      api.getCustomPuzzles(username).then(setCustomPuzzles).catch((e) => setError(e.message));
      api.getPuzzleStats(username).then(setStats).catch(() => {});
    }
    api.getCuratedPuzzles().then(setCuratedPuzzles).catch((e) => setError(e.message));
  }, [username]);

  const queue = source === 'mine' ? customPuzzles : curatedPuzzles;
  const puzzle = queue[index];

  useEffect(() => {
    if (puzzle) {
      setChess(new Chess(puzzle.fen));
      setStep(0);
      setStatus('playing');
    } else {
      setChess(null);
    }
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

  function onPieceDrop({ sourceSquare, targetSquare }) {
    if (!chess || !puzzle || status !== 'playing' || !targetSquare) return false;

    let move;
    try {
      move = chess.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
    } catch {
      return false;
    }
    if (!move) return false;

    const expected = puzzle.solution_san[step];
    if (move.san !== expected && move.san.replace('+', '').replace('#', '') !== expected?.replace('+', '').replace('#', '')) {
      chess.undo();
      setStatus('wrong');
      recordAttempt(false);
      return false;
    }

    const nextStep = step + 1;
    if (nextStep >= puzzle.solution_san.length) {
      setStatus('correct');
      recordAttempt(true);
      setStep(nextStep);
      return true;
    }

    // Auto-play the opponent's reply move in the solution line, then wait for the next user move.
    const replySan = puzzle.solution_san[nextStep];
    setTimeout(() => {
      try {
        chess.move(replySan);
        setStep(nextStep + 1);
        setChess(new Chess(chess.fen()));
        if (nextStep + 1 >= puzzle.solution_san.length) {
          setStatus('correct');
          recordAttempt(true);
        }
      } catch {
        /* ignore malformed curated data */
      }
    }, 400);

    return true;
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
                onPieceDrop,
              }}
            />
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

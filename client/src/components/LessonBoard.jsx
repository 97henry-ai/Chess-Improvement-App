import { useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useChessInteraction } from '../engine/useChessInteraction.js';

/** A free-exploration chessboard for illustrating a lesson's starting idea — either side can move. */
export default function LessonBoard({ fen }) {
  const [chess, setChess] = useState(() => new Chess(fen));

  useEffect(() => {
    setChess(new Chess(fen));
  }, [fen]);

  const { options: interactionOptions, reset } = useChessInteraction({
    chess,
    onMoveMade: () => setChess(new Chess(chess.fen())),
  });

  function resetBoard() {
    setChess(new Chess(fen));
    reset();
  }

  return (
    <div>
      <Chessboard
        options={{
          position: chess.fen(),
          allowDrawingArrows: true,
          id: `lesson-board-${fen}`,
          ...interactionOptions,
        }}
      />
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <button className="btn secondary" style={{ padding: '5px 14px', fontSize: '0.85rem' }} onClick={resetBoard}>
          Reset position
        </button>
      </div>
    </div>
  );
}

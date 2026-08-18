import { useMemo, useState } from 'react';
import { playMoveSound } from './sound.js';

const SELECTED_STYLE = { background: 'rgba(130, 151, 105, 0.6)' };
const LAST_MOVE_STYLE = { background: 'rgba(255, 214, 51, 0.35)' };
const CHECK_STYLE = {
  background:
    'radial-gradient(circle, rgba(224,104,94,0.95) 0%, rgba(224,104,94,0.55) 45%, rgba(224,104,94,0) 78%)',
};
const LEGAL_MOVE_DOT = {
  backgroundImage: 'radial-gradient(circle, rgba(20,24,31,0.35) 20%, transparent 22%)',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
};
const LEGAL_CAPTURE_RING = {
  backgroundImage:
    'radial-gradient(circle, transparent 60%, rgba(20,24,31,0.35) 63%, rgba(20,24,31,0.35) 72%, transparent 75%)',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
};

function findKingSquare(chess, color) {
  const board = chess.board();
  for (const row of board) {
    for (const sq of row) {
      if (sq && sq.type === 'k' && sq.color === color) return sq.square;
    }
  }
  return null;
}

/**
 * Shared click-to-move + drag-to-move interaction for a chess.js instance,
 * with legal-move dots, last-move highlight, check glow, and move sounds.
 * The caller owns `chess` (mutated in place) and re-renders after each move.
 */
export function useChessInteraction({ chess, disabled = false, onMoveMade, onIllegalAttempt, playSounds = true }) {
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [lastMove, setLastMove] = useState(null);

  const legalTargets = useMemo(() => {
    if (!selectedSquare || disabled) return [];
    try {
      return chess.moves({ square: selectedSquare, verbose: true });
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSquare, disabled, chess.fen()]);

  const checkSquare = chess.isCheck() ? findKingSquare(chess, chess.turn()) : null;

  function attemptMove(from, to, promotion = 'q') {
    if (disabled) return false;
    let move = null;
    try {
      move = chess.move({ from, to, promotion });
    } catch {
      move = null;
    }
    if (!move) {
      onIllegalAttempt?.(from, to);
      return false;
    }
    setLastMove({ from: move.from, to: move.to });
    setSelectedSquare(null);
    if (playSounds) {
      const kind = chess.isCheck() ? 'check' : move.captured ? 'capture' : 'move';
      playMoveSound(kind);
    }
    onMoveMade?.(move);
    return true;
  }

  function reset() {
    setSelectedSquare(null);
    setLastMove(null);
  }

  function onSquareClick({ square, piece }) {
    if (disabled) return;
    if (selectedSquare) {
      if (square === selectedSquare) {
        setSelectedSquare(null);
        return;
      }
      const isLegalTarget = legalTargets.some((m) => m.to === square);
      if (isLegalTarget) {
        attemptMove(selectedSquare, square);
        return;
      }
    }
    if (piece && piece.pieceType?.[0]?.toLowerCase() === chess.turn()) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  }

  function onPieceDrop({ sourceSquare, targetSquare }) {
    if (disabled || !targetSquare) return false;
    return attemptMove(sourceSquare, targetSquare);
  }

  function onPieceDrag({ square, piece }) {
    if (disabled) return;
    if (piece && piece.pieceType?.[0]?.toLowerCase() === chess.turn()) {
      setSelectedSquare(square);
    }
  }

  const squareStyles = {};
  if (checkSquare) squareStyles[checkSquare] = CHECK_STYLE;
  if (lastMove) {
    squareStyles[lastMove.from] = { ...(squareStyles[lastMove.from] || {}), ...LAST_MOVE_STYLE };
    squareStyles[lastMove.to] = { ...(squareStyles[lastMove.to] || {}), ...LAST_MOVE_STYLE };
  }
  if (selectedSquare) {
    squareStyles[selectedSquare] = { ...(squareStyles[selectedSquare] || {}), ...SELECTED_STYLE };
  }
  for (const m of legalTargets) {
    squareStyles[m.to] = {
      ...(squareStyles[m.to] || {}),
      ...(m.captured || m.flags?.includes('e') ? LEGAL_CAPTURE_RING : LEGAL_MOVE_DOT),
    };
  }

  return {
    options: {
      allowDragging: !disabled,
      animationDurationInMs: 180,
      squareStyles,
      onSquareClick,
      onPieceDrop,
      onPieceDrag,
    },
    selectedSquare,
    lastMove,
    setLastMove,
    reset,
  };
}

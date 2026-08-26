import { Chess } from 'chess.js';
import { analyzeFen } from './stockfishClient.js';
import { evalToCp, classifyMove } from './classify.js';

const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function uciToSan(fen, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    return move?.san || null;
  } catch {
    return null;
  }
}

function describeSolution(correctSan, correctChess, correctMoveObj, evalAfterCorrect, theme) {
  let solutionWhy;
  if (correctChess.isCheckmate()) {
    solutionWhy = `${correctSan} delivers checkmate — game over.`;
  } else if (correctMoveObj?.captured) {
    solutionWhy = `${correctSan} wins material by capturing the ${PIECE_NAMES[correctMoveObj.captured] || 'piece'}.`;
  } else if (evalAfterCorrect?.evaluation?.mate !== undefined) {
    solutionWhy = `${correctSan} forces a checkmate a few moves from now — your opponent has no way out.`;
  } else if (correctMoveObj?.san?.includes('+')) {
    solutionWhy = `${correctSan} gives a strong check that your opponent can't meet well, keeping the initiative.`;
  } else {
    solutionWhy = `${correctSan} is the strongest move here — it keeps or increases your advantage more than any alternative.`;
  }
  if (theme) {
    solutionWhy += ` This puzzle is built around a ${theme.replace(/-/g, ' ')} pattern.`;
  }
  return solutionWhy;
}

/**
 * Explain a puzzle position with Stockfish: why the correct move works, and
 * (when an attempted move is supplied) why that attempt falls short.
 */
export async function explainPuzzleStep({ fenBefore, correctSan, attemptedSan, moverColor, theme }) {
  const correctChess = new Chess(fenBefore);
  let correctMoveObj = null;
  try {
    correctMoveObj = correctChess.move(correctSan);
  } catch {
    correctMoveObj = null;
  }
  const fenAfterCorrect = correctMoveObj ? correctChess.fen() : null;
  const evalAfterCorrect = fenAfterCorrect && !correctChess.isCheckmate() ? await analyzeFen(fenAfterCorrect, { depth: 12 }) : null;

  const solutionWhy = describeSolution(correctSan, correctChess, correctMoveObj, evalAfterCorrect, theme);

  if (!attemptedSan) {
    return { why: null, solutionWhy };
  }

  const before = await analyzeFen(fenBefore, { depth: 12 });
  const evalBeforeCp = evalToCp(before.evaluation);

  const attemptChess = new Chess(fenBefore);
  let attemptedMoveObj = null;
  try {
    attemptedMoveObj = attemptChess.move(attemptedSan);
  } catch {
    attemptedMoveObj = null;
  }

  let why;
  if (!attemptedMoveObj) {
    why = `${attemptedSan} isn't a legal move here.`;
  } else if (correctMoveObj && attemptedMoveObj.san === correctMoveObj.san) {
    why = null;
  } else {
    const fenAfterAttempt = attemptChess.fen();
    const afterAttempt = await analyzeFen(fenAfterAttempt, { depth: 12 });
    const evalAfterAttemptCp = evalToCp(afterAttempt.evaluation);
    const { loss } = classifyMove(evalBeforeCp, evalAfterAttemptCp, moverColor);
    const refutationSan = afterAttempt.pv?.[0] ? uciToSan(fenAfterAttempt, afterAttempt.pv[0]) : null;

    if (!attemptedMoveObj.captured && refutationSan?.includes('x')) {
      why = `${attemptedSan} doesn't handle the position — your opponent answers with ${refutationSan}, winning material.`;
    } else if (loss >= 300) {
      why = `${attemptedSan} gives back most of your advantage — it's not the strongest continuation here.`;
    } else if (loss >= 50) {
      why = `${attemptedSan} is a reasonable try, but it isn't accurate enough to be the solution.`;
    } else {
      why = `${attemptedSan} is playable, but it doesn't find the strongest continuation the puzzle is looking for.`;
    }
  }

  return { why, solutionWhy };
}

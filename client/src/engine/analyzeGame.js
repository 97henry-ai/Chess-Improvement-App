import { Chess } from 'chess.js';
import { analyzeFen } from './stockfishClient.js';
import { evalToCp, classifyMove } from './classify.js';

export function buildPliesFromPgn(pgn) {
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
    plies.push({ ply: i + 1, san: move.san, color: move.color, fenBefore, fenAfter, isCheckmateAfter: replay.isCheckmate() });
  });
  return plies;
}

/**
 * A fast, classification-only analysis pass (lower depth, single line, no
 * alternatives/refutation lines) — used for automatically analyzing a whole
 * batch of games after a sync, where per-move detail matters less than
 * covering every game quickly. The Analyzer page's manual "Run Stockfish
 * analysis" does a deeper multi-line pass on one game at a time instead.
 */
export async function quickAnalyzeGame(pgn, { depth = 10, onMoveProgress } = {}) {
  const plies = buildPliesFromPgn(pgn);
  const results = [];
  for (let i = 0; i < plies.length; i++) {
    const p = plies[i];
    const before = await analyzeFen(p.fenBefore, { depth });
    const evalBeforeCp = evalToCp(before.evaluation);

    if (p.isCheckmateAfter) {
      // No legal replies to score — delivering mate is always the best possible move.
      results.push({ ...p, evalBefore: evalBeforeCp, evalAfter: evalBeforeCp, evalLoss: 0, classification: 'best' });
    } else {
      const after = await analyzeFen(p.fenAfter, { depth });
      const evalAfterCp = evalToCp(after.evaluation);
      const { loss, classification } = classifyMove(evalBeforeCp, evalAfterCp, p.color);
      results.push({ ...p, evalBefore: evalBeforeCp, evalAfter: evalAfterCp, evalLoss: loss, classification });
    }
    onMoveProgress?.(i + 1, plies.length);
  }
  return results;
}

/** Analyze a batch of games sequentially and persist each one via saveGameAnalysis. */
export async function analyzeGamesBatch(games, { saveGameAnalysis, onGameProgress, onMoveProgress } = {}) {
  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    onGameProgress?.(i + 1, games.length, game);
    const plies = await quickAnalyzeGame(game.pgn, {
      onMoveProgress: (done, total) => onMoveProgress?.(done, total, i + 1, games.length),
    });
    await saveGameAnalysis(
      game.id,
      plies.map((r) => ({
        ply: r.ply,
        move_san: r.san,
        fen_before: r.fenBefore,
        fen_after: r.fenAfter,
        eval_before: r.evalBefore,
        eval_after: r.evalAfter,
        eval_loss: r.evalLoss,
        classification: r.classification,
        best_move_san: null,
      }))
    );
  }
}

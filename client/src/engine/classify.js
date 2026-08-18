/** Convert an engine evaluation object to a centipawn number (mate scores clamped to a large value). */
export function evalToCp(evaluation) {
  if (!evaluation) return 0;
  if (evaluation.mate !== undefined) return evaluation.mate > 0 ? 10000 - evaluation.mate : -10000 - evaluation.mate;
  return evaluation.cp;
}

/**
 * Classify a move by how much it dropped the mover's evaluation.
 * evalBeforeCp/evalAfterCp are both from White's perspective; movedColor is 'w' or 'b'.
 */
export function classifyMove(evalBeforeCp, evalAfterCp, movedColor) {
  const sign = movedColor === 'w' ? 1 : -1;
  const before = evalBeforeCp * sign;
  const after = evalAfterCp * sign;
  const loss = Math.max(0, before - after);

  let classification = 'good';
  if (loss >= 300) classification = 'blunder';
  else if (loss >= 120) classification = 'mistake';
  else if (loss >= 50) classification = 'inaccuracy';
  else if (loss <= 5) classification = 'best';

  return { loss, classification };
}

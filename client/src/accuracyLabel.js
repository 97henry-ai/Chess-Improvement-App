/**
 * Translate average centipawn loss (ACPL) — a number nobody outside chess
 * engines finds meaningful — into a plain-language grade. The raw number is
 * still computed internally (for sorting/severity), it's just never the
 * headline anymore.
 */
export function acplLevel(acpl) {
  if (acpl <= 40) return { label: 'Excellent', tone: 'win' };
  if (acpl <= 80) return { label: 'Good', tone: '' };
  if (acpl <= 150) return { label: 'Shaky', tone: 'draw' };
  return { label: 'Rough', tone: 'loss' };
}

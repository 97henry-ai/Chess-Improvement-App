const RATED_MODES = ['chess_bullet', 'chess_blitz', 'chess_rapid', 'chess_daily'];

/** The highest current rating a player has across all chess.com time controls. */
export function highestRating(stats) {
  if (!stats) return null;
  const ratings = RATED_MODES.map((mode) => stats[mode]?.last?.rating).filter((r) => typeof r === 'number');
  return ratings.length ? Math.max(...ratings) : null;
}

import { Router } from 'express';
import * as chesscom from '../services/chesscom.js';
import { parsePgnHeaders } from '../services/pgn.js';
import db from '../db/index.js';

const router = Router();

function eco_to_opening(ecoUrl) {
  if (!ecoUrl) return null;
  try {
    const slug = ecoUrl.split('/').pop();
    return slug.replace(/-/g, ' ');
  } catch {
    return null;
  }
}

function toRow(game, username) {
  const headers = parsePgnHeaders(game.pgn || '');
  const isWhite = game.white?.username?.toLowerCase() === username.toLowerCase();
  const playerColor = isWhite ? 'white' : 'black';
  const playerResultCode = isWhite ? game.white?.result : game.black?.result;
  let playerResult = 'unknown';
  if (playerResultCode === 'win') playerResult = 'win';
  else if (['checkmated', 'timeout', 'resigned', 'lose', 'abandoned'].includes(playerResultCode)) playerResult = 'loss';
  else if (playerResultCode) playerResult = 'draw';

  return [
    username,
    game.url,
    game.pgn || '',
    game.time_class || null,
    game.end_time || null,
    game.white?.username || headers.White || null,
    game.black?.username || headers.Black || null,
    game.white?.rating || null,
    game.black?.rating || null,
    headers.Result || null,
    playerColor,
    playerResult,
    headers.ECO || null,
    eco_to_opening(game.eco) || headers.Opening || null,
  ];
}

// Pull recent games from chess.com and store new ones locally.
router.post('/:username/sync', async (req, res) => {
  const { username } = req.params;
  const monthsBack = Math.min(Number(req.body?.monthsBack) || 3, 12);
  const client = await db.connect();
  try {
    const games = await chesscom.getRecentGames(username, monthsBack);
    const rows = games.map((g) => toRow(g, username));

    await client.query('BEGIN');
    let inserted = 0;
    for (const row of rows) {
      const result = await client.query(
        `INSERT INTO games (username, chesscom_url, pgn, time_class, end_time, white, black,
           white_rating, black_rating, result, player_color, player_result, eco, opening_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (chesscom_url) DO NOTHING`,
        row
      );
      if (result.rowCount > 0) inserted++;
    }
    await client.query(
      `INSERT INTO users (username, last_synced_at) VALUES ($1, NOW())
       ON CONFLICT (username) DO UPDATE SET last_synced_at = NOW()`,
      [username]
    );
    await client.query('COMMIT');

    const { rows: countRows } = await client.query('SELECT COUNT(*)::int c FROM games WHERE username = $1', [username]);
    res.json({ fetched: games.length, inserted, totalStored: countRows[0].c });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.status || 500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.get('/:username', async (req, res) => {
  const { username } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const { rows } = await db.query('SELECT * FROM games WHERE username = $1 ORDER BY end_time DESC LIMIT $2', [username, limit]);
  res.json(rows);
});

router.get('/:username/summary', async (req, res) => {
  const { username } = req.params;
  const { rows } = await db.query(
    'SELECT player_result, time_class, opening_name, player_color FROM games WHERE username = $1',
    [username]
  );
  const summary = { total: rows.length, wins: 0, losses: 0, draws: 0, byTimeClass: {}, byOpening: {}, byColor: { white: 0, black: 0 } };
  for (const r of rows) {
    if (r.player_result === 'win') summary.wins++;
    else if (r.player_result === 'loss') summary.losses++;
    else if (r.player_result === 'draw') summary.draws++;
    if (r.time_class) summary.byTimeClass[r.time_class] = (summary.byTimeClass[r.time_class] || 0) + 1;
    if (r.opening_name) summary.byOpening[r.opening_name] = (summary.byOpening[r.opening_name] || 0) + 1;
    if (r.player_color) summary.byColor[r.player_color] = (summary.byColor[r.player_color] || 0) + 1;
  }
  res.json(summary);
});

/**
 * Aggregate the connected player's own analyzed moves (across all analyzed games)
 * into three basic facets — opening, middlegame, endgame — each summarized by
 * average centipawn loss and mistake/blunder counts. This is the data behind
 * the Dashboard's performance summary and training plan.
 */
router.get('/:username/performance', async (req, res) => {
  const { username } = req.params;
  const { rows: games } = await db.query('SELECT id, player_color FROM games WHERE username = $1 AND analyzed = 1', [username]);

  const emptyBucket = () => ({ moves: 0, lossSum: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 });
  const phaseBuckets = { opening: emptyBucket(), middlegame: emptyBucket(), endgame: emptyBucket() };

  if (games.length > 0) {
    const gameById = new Map(games.map((g) => [g.id, g]));
    const { rows: moveRows } = await db.query(
      'SELECT game_id, ply, classification, eval_loss FROM game_moves WHERE game_id = ANY($1::int[])',
      [games.map((g) => g.id)]
    );

    const maxPlyByGame = {};
    for (const row of moveRows) {
      maxPlyByGame[row.game_id] = Math.max(maxPlyByGame[row.game_id] || 0, row.ply);
    }

    for (const row of moveRows) {
      const game = gameById.get(row.game_id);
      if (!game || !row.classification) continue;
      const isWhiteMove = row.ply % 2 === 1;
      const moverIsPlayer = isWhiteMove === (game.player_color === 'white');
      if (!moverIsPlayer) continue; // only count the connected player's own moves, not the opponent's

      const maxPly = maxPlyByGame[row.game_id] || row.ply;
      const endgameStart = maxPly - Math.max(10, Math.round(maxPly * 0.25));
      let phase = 'middlegame';
      if (row.ply <= 16) phase = 'opening';
      else if (row.ply > endgameStart) phase = 'endgame';

      const bucket = phaseBuckets[phase];
      bucket.moves++;
      // Cap each move's contribution to the ACPL average — an already-lost position that
      // gets even more lost (e.g. walking into forced mate) shouldn't skew the average by
      // thousands of centipawns for a single move, the same convention chess.com/Lichess use.
      bucket.lossSum += Math.min(row.eval_loss || 0, 1000);
      bucket[row.classification] = (bucket[row.classification] || 0) + 1;
    }
  }

  const summarize = (b) => ({
    moves: b.moves,
    acpl: b.moves ? Math.round(b.lossSum / b.moves) : 0,
    blunders: b.blunder,
    mistakes: b.mistake,
    inaccuracies: b.inaccuracy,
  });

  const overall = emptyBucket();
  for (const key of Object.keys(phaseBuckets)) {
    const b = phaseBuckets[key];
    overall.moves += b.moves;
    overall.lossSum += b.lossSum;
    overall.blunder += b.blunder;
    overall.mistake += b.mistake;
    overall.inaccuracy += b.inaccuracy;
  }

  res.json({
    gamesAnalyzed: games.length,
    phases: {
      opening: summarize(phaseBuckets.opening),
      middlegame: summarize(phaseBuckets.middlegame),
      endgame: summarize(phaseBuckets.endgame),
    },
    overall: summarize(overall),
  });
});

router.get('/detail/:gameId', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM games WHERE id = $1', [req.params.gameId]);
  const game = rows[0];
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const { rows: moves } = await db.query('SELECT * FROM game_moves WHERE game_id = $1 ORDER BY ply ASC', [game.id]);
  res.json({ ...game, moves });
});

// Client runs Stockfish locally and posts back per-move analysis to persist it.
router.post('/detail/:gameId/analysis', async (req, res) => {
  const gameId = Number(req.params.gameId);
  const { moves } = req.body;
  if (!Array.isArray(moves)) return res.status(400).json({ error: 'moves array required' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM game_moves WHERE game_id = $1', [gameId]);
    for (const r of moves) {
      await client.query(
        `INSERT INTO game_moves (game_id, ply, move_san, fen_before, fen_after, eval_before, eval_after, eval_loss, classification, best_move_san)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [gameId, r.ply, r.move_san, r.fen_before, r.fen_after, r.eval_before, r.eval_after, r.eval_loss, r.classification, r.best_move_san]
      );
    }
    await client.query('UPDATE games SET analyzed = 1 WHERE id = $1', [gameId]);
    await client.query('COMMIT');
    res.json({ ok: true, saved: moves.length });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;

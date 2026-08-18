import { Router } from 'express';
import * as chesscom from '../services/chesscom.js';
import { parsePgnHeaders } from '../services/pgn.js';
import db from '../db/index.js';

const router = Router();

const insertGame = db.prepare(`
  INSERT INTO games (username, chesscom_url, pgn, time_class, end_time, white, black,
    white_rating, black_rating, result, player_color, player_result, eco, opening_name)
  VALUES (@username, @chesscom_url, @pgn, @time_class, @end_time, @white, @black,
    @white_rating, @black_rating, @result, @player_color, @player_result, @eco, @opening_name)
  ON CONFLICT(chesscom_url) DO NOTHING
`);

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

  return {
    username,
    chesscom_url: game.url,
    pgn: game.pgn || '',
    time_class: game.time_class || null,
    end_time: game.end_time || null,
    white: game.white?.username || headers.White || null,
    black: game.black?.username || headers.Black || null,
    white_rating: game.white?.rating || null,
    black_rating: game.black?.rating || null,
    result: headers.Result || null,
    player_color: playerColor,
    player_result: playerResult,
    eco: headers.ECO || null,
    opening_name: eco_to_opening(game.eco) || headers.Opening || null,
  };
}

// Pull recent games from chess.com and store new ones locally.
router.post('/:username/sync', async (req, res) => {
  const { username } = req.params;
  const monthsBack = Math.min(Number(req.body?.monthsBack) || 3, 12);
  try {
    const games = await chesscom.getRecentGames(username, monthsBack);
    const insertMany = db.transaction((rows) => {
      let inserted = 0;
      for (const row of rows) {
        const info = insertGame.run(row);
        if (info.changes > 0) inserted++;
      }
      return inserted;
    });
    const rows = games.map((g) => toRow(g, username));
    const inserted = insertMany(rows);

    db.prepare(
      `INSERT INTO users (username, last_synced_at) VALUES (?, CURRENT_TIMESTAMP)
       ON CONFLICT(username) DO UPDATE SET last_synced_at = CURRENT_TIMESTAMP`
    ).run(username);

    res.json({ fetched: games.length, inserted, totalStored: db.prepare('SELECT COUNT(*) c FROM games WHERE username = ?').get(username).c });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:username', (req, res) => {
  const { username } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const games = db
    .prepare('SELECT * FROM games WHERE username = ? ORDER BY end_time DESC LIMIT ?')
    .all(username, limit);
  res.json(games);
});

router.get('/:username/summary', (req, res) => {
  const { username } = req.params;
  const rows = db.prepare('SELECT player_result, time_class, opening_name, player_color FROM games WHERE username = ?').all(username);
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
router.get('/:username/performance', (req, res) => {
  const { username } = req.params;
  const games = db.prepare('SELECT id, player_color FROM games WHERE username = ? AND analyzed = 1').all(username);

  const emptyBucket = () => ({ moves: 0, lossSum: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 });
  const phaseBuckets = { opening: emptyBucket(), middlegame: emptyBucket(), endgame: emptyBucket() };

  if (games.length > 0) {
    const gameById = new Map(games.map((g) => [g.id, g]));
    const placeholders = games.map(() => '?').join(',');
    const moveRows = db
      .prepare(`SELECT game_id, ply, classification, eval_loss FROM game_moves WHERE game_id IN (${placeholders})`)
      .all(...games.map((g) => g.id));

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

router.get('/detail/:gameId', (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const moves = db.prepare('SELECT * FROM game_moves WHERE game_id = ? ORDER BY ply ASC').all(game.id);
  res.json({ ...game, moves });
});

// Client runs Stockfish locally and posts back per-move analysis to persist it.
router.post('/detail/:gameId/analysis', (req, res) => {
  const gameId = Number(req.params.gameId);
  const { moves } = req.body;
  if (!Array.isArray(moves)) return res.status(400).json({ error: 'moves array required' });

  const insertMove = db.prepare(`
    INSERT INTO game_moves (game_id, ply, move_san, fen_before, fen_after, eval_before, eval_after, eval_loss, classification, best_move_san)
    VALUES (@game_id, @ply, @move_san, @fen_before, @fen_after, @eval_before, @eval_after, @eval_loss, @classification, @best_move_san)
  `);
  const tx = db.transaction((rows) => {
    db.prepare('DELETE FROM game_moves WHERE game_id = ?').run(gameId);
    for (const r of rows) insertMove.run({ game_id: gameId, ...r });
    db.prepare('UPDATE games SET analyzed = 1 WHERE id = ?').run(gameId);
  });
  tx(moves);
  res.json({ ok: true, saved: moves.length });
});

export default router;

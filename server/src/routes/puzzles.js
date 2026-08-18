import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const curated = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'curatedPuzzles.json'), 'utf-8'));

const router = Router();

// Client analyzes its own games with Stockfish and posts blunders here to become puzzles.
router.post('/:username/custom', (req, res) => {
  const { username } = req.params;
  const { fen, solution_san, theme, eval_loss, game_id, rating } = req.body;
  if (!fen || !solution_san) return res.status(400).json({ error: 'fen and solution_san required' });

  const info = db
    .prepare(
      `INSERT INTO puzzles (username, source, game_id, fen, solution_san, theme, eval_loss, rating)
       VALUES (?, 'custom', ?, ?, ?, ?, ?, ?)`
    )
    .run(username, game_id || null, fen, JSON.stringify(solution_san), theme || 'blunder-recovery', eval_loss || null, rating || null);
  res.json({ id: info.lastInsertRowid });
});

router.get('/:username/custom', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM puzzles WHERE username = ? AND source = ? ORDER BY created_at DESC')
    .all(req.params.username, 'custom');
  res.json(rows.map((r) => ({ ...r, solution_san: JSON.parse(r.solution_san) })));
});

router.get('/curated', (req, res) => {
  const { theme, near } = req.query;
  const filtered = theme ? curated.filter((p) => p.theme === theme) : curated;
  const withIds = filtered.map((p, i) => ({ id: `curated-${i}`, source: 'curated', ...p }));

  // When a target rating is given, order puzzles closest-to-your-level first
  // rather than by insertion order — this is what "calibrated to your rating" means in practice.
  const target = Number(near);
  if (near !== undefined && !Number.isNaN(target)) {
    withIds.sort((a, b) => Math.abs((a.rating ?? target) - target) - Math.abs((b.rating ?? target) - target));
  }

  res.json(withIds);
});

router.post('/:puzzleId/attempt', (req, res) => {
  const puzzleId = Number(req.params.puzzleId);
  const { username, correct } = req.body;
  if (Number.isNaN(puzzleId)) return res.status(404).json({ error: 'Custom puzzle attempts only tracked for saved puzzles' });

  db.prepare('INSERT INTO puzzle_attempts (puzzle_id, username, correct) VALUES (?, ?, ?)').run(
    puzzleId,
    username,
    correct ? 1 : 0
  );
  db.prepare(
    `UPDATE puzzles SET times_attempted = times_attempted + 1,
       times_solved = times_solved + ?,
       last_attempted_at = CURRENT_TIMESTAMP,
       mastered = CASE WHEN ? = 1 AND times_solved + 1 >= 2 THEN 1 ELSE mastered END
     WHERE id = ?`
  ).run(correct ? 1 : 0, correct ? 1 : 0, puzzleId);
  res.json({ ok: true });
});

router.get('/:username/stats', (req, res) => {
  const row = db
    .prepare(
      `SELECT COUNT(*) attempted, SUM(correct) solved FROM puzzle_attempts WHERE username = ?`
    )
    .get(req.params.username);
  const themeBreakdown = db
    .prepare(
      `SELECT p.theme, COUNT(*) attempts, SUM(a.correct) solved
       FROM puzzle_attempts a JOIN puzzles p ON p.id = a.puzzle_id
       WHERE a.username = ? GROUP BY p.theme`
    )
    .all(req.params.username);
  res.json({ attempted: row.attempted || 0, solved: row.solved || 0, themeBreakdown });
});

export default router;

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const curated = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'curatedPuzzles.json'), 'utf-8'));

const router = Router();

// --- Daily 10 plan helpers -------------------------------------------------

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

// A small deterministic PRNG (mulberry32) so a given username+date always
// produces the same shuffle — the daily plan stays stable across reloads,
// but rotates day to day.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build today's personalized set of 10 puzzle references: a few of the
 * player's own unmastered blunders (highest personalization), filled out
 * with curated puzzles favoring their weakness themes and calibrated to
 * their rating. Deterministic per username+date so it's stable all day.
 */
function generateDailyPlanRefs(username, near, dateStr) {
  const rng = mulberry32(hashSeed(`${username}:${dateStr}`));

  const weaknessRow = db.prepare('SELECT data FROM weakness_profile WHERE username = ?').get(username);
  const themeSet = new Set(weaknessRow ? JSON.parse(weaknessRow.data).themes || [] : []);

  const customRows = db
    .prepare('SELECT id FROM puzzles WHERE username = ? AND source = ? AND mastered = 0 ORDER BY created_at DESC')
    .all(username, 'custom');
  const customPicked = seededShuffle(customRows, rng)
    .slice(0, 4)
    .map((r) => ({ source: 'custom', id: r.id }));

  const target = Number(near) || 1200;
  const curatedScored = curated.map((p, i) => ({
    ref: { source: 'curated', id: `curated-${i}` },
    themeMatch: themeSet.has(p.theme) ? 1 : 0,
    distance: Math.abs((p.rating ?? target) - target),
    jitter: rng(),
  }));
  curatedScored.sort((a, b) => b.themeMatch - a.themeMatch || a.distance - b.distance || a.jitter - b.jitter);

  const remaining = Math.max(0, 10 - customPicked.length);
  const curatedPicked = curatedScored.slice(0, remaining).map((c) => c.ref);

  return [...customPicked, ...curatedPicked].slice(0, 10);
}

function resolveDailyRefs(refs) {
  const customIds = refs.filter((r) => r.source === 'custom').map((r) => r.id);
  const customById = new Map();
  if (customIds.length) {
    const placeholders = customIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM puzzles WHERE id IN (${placeholders})`).all(...customIds);
    for (const r of rows) customById.set(r.id, { ...r, solution_san: JSON.parse(r.solution_san), source: 'custom' });
  }
  return refs
    .map((ref) => {
      if (ref.source === 'custom') return customById.get(ref.id) || null;
      const idx = Number(String(ref.id).replace('curated-', ''));
      const p = curated[idx];
      return p ? { id: ref.id, source: 'curated', ...p } : null;
    })
    .filter(Boolean);
}

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

// A stable, personalized set of 10 puzzles for today — generated once per
// username+date and reused on every request for that day.
router.get('/:username/daily', (req, res) => {
  const { username } = req.params;
  const { near } = req.query;
  const today = new Date().toISOString().slice(0, 10);

  const existing = db.prepare('SELECT puzzle_refs FROM daily_plans WHERE username = ? AND plan_date = ?').get(username, today);
  let refs;
  if (existing) {
    refs = JSON.parse(existing.puzzle_refs);
  } else {
    refs = generateDailyPlanRefs(username, near, today);
    db.prepare('INSERT INTO daily_plans (username, plan_date, puzzle_refs) VALUES (?, ?, ?)').run(username, today, JSON.stringify(refs));
  }

  res.json({ date: today, puzzles: resolveDailyRefs(refs) });
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

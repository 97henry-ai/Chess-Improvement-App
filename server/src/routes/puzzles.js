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
async function generateDailyPlanRefs(username, near, dateStr) {
  const rng = mulberry32(hashSeed(`${username}:${dateStr}`));

  const { rows: weaknessRows } = await db.query('SELECT data FROM weakness_profile WHERE username = $1', [username]);
  const themeSet = new Set(weaknessRows[0] ? JSON.parse(weaknessRows[0].data).themes || [] : []);

  const { rows: customRows } = await db.query(
    "SELECT id FROM puzzles WHERE username = $1 AND source = 'custom' AND mastered = 0 ORDER BY created_at DESC",
    [username]
  );
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

async function resolveDailyRefs(refs) {
  const customIds = refs.filter((r) => r.source === 'custom').map((r) => r.id);
  const customById = new Map();
  if (customIds.length) {
    const { rows } = await db.query('SELECT * FROM puzzles WHERE id = ANY($1::int[])', [customIds]);
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
router.post('/:username/custom', async (req, res) => {
  const { username } = req.params;
  const { fen, solution_san, theme, eval_loss, game_id, rating } = req.body;
  if (!fen || !solution_san) return res.status(400).json({ error: 'fen and solution_san required' });

  const { rows } = await db.query(
    `INSERT INTO puzzles (username, source, game_id, fen, solution_san, theme, eval_loss, rating)
     VALUES ($1, 'custom', $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [username, game_id || null, fen, JSON.stringify(solution_san), theme || 'blunder-recovery', eval_loss || null, rating || null]
  );
  res.json({ id: rows[0].id });
});

router.get('/:username/custom', async (req, res) => {
  const { rows } = await db.query("SELECT * FROM puzzles WHERE username = $1 AND source = 'custom' ORDER BY created_at DESC", [
    req.params.username,
  ]);
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
router.get('/:username/daily', async (req, res) => {
  const { username } = req.params;
  const { near } = req.query;
  const today = new Date().toISOString().slice(0, 10);

  const { rows: existingRows } = await db.query('SELECT puzzle_refs FROM daily_plans WHERE username = $1 AND plan_date = $2', [
    username,
    today,
  ]);
  let refs;
  if (existingRows[0]) {
    refs = JSON.parse(existingRows[0].puzzle_refs);
  } else {
    refs = await generateDailyPlanRefs(username, near, today);
    await db.query('INSERT INTO daily_plans (username, plan_date, puzzle_refs) VALUES ($1, $2, $3)', [
      username,
      today,
      JSON.stringify(refs),
    ]);
  }

  res.json({ date: today, puzzles: await resolveDailyRefs(refs) });
});

router.post('/:puzzleId/attempt', async (req, res) => {
  const puzzleId = Number(req.params.puzzleId);
  const { username, correct } = req.body;
  if (Number.isNaN(puzzleId)) return res.status(404).json({ error: 'Custom puzzle attempts only tracked for saved puzzles' });

  const correctVal = correct ? 1 : 0;
  await db.query('INSERT INTO puzzle_attempts (puzzle_id, username, correct) VALUES ($1, $2, $3)', [puzzleId, username, correctVal]);
  await db.query(
    `UPDATE puzzles SET times_attempted = times_attempted + 1,
       times_solved = times_solved + $1,
       last_attempted_at = NOW(),
       mastered = CASE WHEN $1 = 1 AND times_solved + 1 >= 2 THEN 1 ELSE mastered END
     WHERE id = $2`,
    [correctVal, puzzleId]
  );
  res.json({ ok: true });
});

router.get('/:username/stats', async (req, res) => {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int attempted, COALESCE(SUM(correct), 0)::int solved FROM puzzle_attempts WHERE username = $1',
    [req.params.username]
  );
  const { rows: themeBreakdown } = await db.query(
    `SELECT p.theme, COUNT(*)::int attempts, COALESCE(SUM(a.correct), 0)::int solved
     FROM puzzle_attempts a JOIN puzzles p ON p.id = a.puzzle_id
     WHERE a.username = $1 GROUP BY p.theme`,
    [req.params.username]
  );
  res.json({ attempted: rows[0].attempted || 0, solved: rows[0].solved || 0, themeBreakdown });
});

export default router;

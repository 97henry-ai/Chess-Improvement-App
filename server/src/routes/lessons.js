import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lessons = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'lessons.json'), 'utf-8'));

const router = Router();

router.get('/', (req, res) => {
  const { category, level } = req.query;
  let result = lessons;
  if (category) result = result.filter((l) => l.category === category);
  if (level) result = result.filter((l) => l.level === level);
  res.json(result);
});

router.get('/:id', (req, res) => {
  const lesson = lessons.find((l) => l.id === req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  res.json(lesson);
});

/**
 * Weakness profile: mine theme frequency from saved blunder puzzles (weighted by eval_loss)
 * and from low puzzle solve-rates, then recommend lessons whose themeTags overlap.
 */
router.post('/:username/recompute', async (req, res) => {
  const { username } = req.params;

  const { rows: blunderThemes } = await db.query(
    `SELECT theme, COUNT(*)::int count, AVG(eval_loss) avg_loss
     FROM puzzles WHERE username = $1 AND source = 'custom' GROUP BY theme ORDER BY count DESC`,
    [username]
  );

  const { rows: weakThemeRows } = await db.query(
    `SELECT p.theme, COUNT(*)::int attempts, COALESCE(SUM(a.correct), 0)::int solved
     FROM puzzle_attempts a JOIN puzzles p ON p.id = a.puzzle_id
     WHERE a.username = $1 GROUP BY p.theme HAVING COUNT(*) >= 2`,
    [username]
  );
  const weakThemes = weakThemeRows.filter((t) => t.solved / t.attempts < 0.5).map((t) => t.theme);

  const themeScores = new Map();
  for (const t of blunderThemes) {
    themeScores.set(t.theme, (themeScores.get(t.theme) || 0) + t.count * 2 + (t.avg_loss || 0) / 100);
  }
  for (const theme of weakThemes) {
    themeScores.set(theme, (themeScores.get(theme) || 0) + 3);
  }

  const rankedThemes = [...themeScores.entries()].sort((a, b) => b[1] - a[1]).map(([theme]) => theme);

  const recommendedLessons = [];
  for (const theme of rankedThemes) {
    for (const lesson of lessons) {
      if (lesson.themeTags.includes(theme) && !recommendedLessons.includes(lesson.id)) {
        recommendedLessons.push(lesson.id);
      }
    }
  }
  // Fill in fundamentals if the user has no data yet.
  if (recommendedLessons.length === 0) {
    recommendedLessons.push('openings-e4-principles', 'tactics-forks', 'endgame-king-pawn');
  }

  const data = { themes: rankedThemes, recommendedLessons };
  await db.query(
    `INSERT INTO weakness_profile (username, data, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (username) DO UPDATE SET data = excluded.data, updated_at = NOW()`,
    [username, JSON.stringify(data)]
  );

  res.json(data);
});

export default router;

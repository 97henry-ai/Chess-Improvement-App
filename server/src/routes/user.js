import { Router } from 'express';
import * as chesscom from '../services/chesscom.js';
import db from '../db/index.js';

const router = Router();

router.get('/:username/profile', async (req, res) => {
  try {
    const profile = await chesscom.getProfile(req.params.username);
    res.json(profile);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:username/stats', async (req, res) => {
  try {
    const stats = await chesscom.getStats(req.params.username);
    res.json(stats);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:username/weakness-profile', (req, res) => {
  const row = db.prepare('SELECT data, updated_at FROM weakness_profile WHERE username = ?').get(req.params.username);
  if (!row) return res.json({ themes: [], updated_at: null });
  res.json({ ...JSON.parse(row.data), updated_at: row.updated_at });
});

export default router;

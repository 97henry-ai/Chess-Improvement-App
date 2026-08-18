import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import userRoutes from './routes/user.js';
import gameRoutes from './routes/games.js';
import puzzleRoutes from './routes/puzzles.js';
import lessonRoutes from './routes/lessons.js';
import './db/index.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/user', userRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/puzzles', puzzleRoutes);
app.use('/api/lessons', lessonRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Chess Improvement API listening on http://localhost:${PORT}`);
});

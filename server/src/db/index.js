import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required — set it to a Postgres connection string.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS games (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  chesscom_url TEXT UNIQUE,
  pgn TEXT NOT NULL,
  time_class TEXT,
  end_time BIGINT,
  white TEXT,
  black TEXT,
  white_rating INTEGER,
  black_rating INTEGER,
  result TEXT,
  player_color TEXT,
  player_result TEXT,
  eco TEXT,
  opening_name TEXT,
  analyzed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_games_username ON games(username);

CREATE TABLE IF NOT EXISTS game_moves (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply INTEGER NOT NULL,
  move_san TEXT NOT NULL,
  fen_before TEXT NOT NULL,
  fen_after TEXT NOT NULL,
  eval_before REAL,
  eval_after REAL,
  eval_loss REAL,
  classification TEXT,
  best_move_san TEXT
);
CREATE INDEX IF NOT EXISTS idx_moves_game ON game_moves(game_id);

CREATE TABLE IF NOT EXISTS puzzles (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'custom',
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  fen TEXT NOT NULL,
  solution_san TEXT NOT NULL,
  theme TEXT,
  eval_loss REAL,
  rating INTEGER,
  times_attempted INTEGER DEFAULT 0,
  times_solved INTEGER DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  mastered INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_puzzles_username ON puzzles(username);

CREATE TABLE IF NOT EXISTS puzzle_attempts (
  id SERIAL PRIMARY KEY,
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  correct INTEGER NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weakness_profile (
  username TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_plans (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  plan_date TEXT NOT NULL,
  puzzle_refs TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(username, plan_date)
);
`);

export default pool;

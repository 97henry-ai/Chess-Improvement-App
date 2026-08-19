import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'chess.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  chesscom_url TEXT UNIQUE,
  pgn TEXT NOT NULL,
  time_class TEXT,
  end_time INTEGER,
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_games_username ON games(username);

CREATE TABLE IF NOT EXISTS game_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  last_attempted_at TEXT,
  mastered INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_puzzles_username ON puzzles(username);

CREATE TABLE IF NOT EXISTS puzzle_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  correct INTEGER NOT NULL,
  attempted_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS weakness_profile (
  username TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  plan_date TEXT NOT NULL,
  puzzle_refs TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(username, plan_date)
);
`);

export default db;

import db from '../src/db/index.js';

const pgn = `[Event "Test Game"]
[Site "Local"]
[White "opponent"]
[Black "testuser"]
[Result "1-0"]
[ECO "C50"]

1. e4 e5 2. Bc4 Bc5 3. Qh5 Nf6 4. Qxf7# 1-0`;

// Deliberately blundery PGN (Scholar's mate) so Analyzer/blunder-detection has something to find.
await db.query(
  `INSERT INTO games (username, chesscom_url, pgn, time_class, end_time, white, black,
    white_rating, black_rating, result, player_color, player_result, eco, opening_name)
   VALUES ($1, $2, $3, 'rapid', extract(epoch from now()), 'opponent', 'testuser', 900, 900, '1-0', 'black', 'loss', 'C50', 'Italian Game')
   ON CONFLICT (chesscom_url) DO NOTHING`,
  ['testuser', 'local-test-game-1', pgn]
);

const { rows } = await db.query('SELECT id FROM games WHERE chesscom_url = $1', ['local-test-game-1']);
console.log('Seeded game id:', rows[0].id);
process.exit(0);

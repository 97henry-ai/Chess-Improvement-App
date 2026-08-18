import db from '../src/db/index.js';

const pgn = `[Event "Test Game"]
[Site "Local"]
[White "opponent"]
[Black "testuser"]
[Result "1-0"]
[ECO "C50"]

1. e4 e5 2. Bc4 Bc5 3. Qh5 Nf6 4. Qxf7# 1-0`;

// Deliberately blundery PGN (Scholar's mate) so Analyzer/blunder-detection has something to find.
db.prepare(`
  INSERT INTO games (username, chesscom_url, pgn, time_class, end_time, white, black,
    white_rating, black_rating, result, player_color, player_result, eco, opening_name)
  VALUES (?, ?, ?, 'rapid', strftime('%s','now'), 'opponent', 'testuser', 900, 900, '1-0', 'black', 'loss', 'C50', 'Italian Game')
`).run('testuser', 'local-test-game-1', pgn);

console.log('Seeded game id:', db.prepare('SELECT id FROM games WHERE chesscom_url = ?').get('local-test-game-1').id);

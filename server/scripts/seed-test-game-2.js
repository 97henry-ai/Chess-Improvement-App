import db from '../src/db/index.js';

// A longer, more natural game (not an instant mating trap) to exercise a wider
// range of mistake types in the Analyzer's explanation logic.
const pgn = `[Event "Test Game 2"]
[Site "Local"]
[White "testuser"]
[Black "opponent"]
[Result "0-1"]
[ECO "B01"]

1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5 4. d4 Nf6 5. Nf3 c6 6. Bc4 Bf5 7. Bd2 e6
8. Qe2 Bb4 9. O-O-O Nbd7 10. g4 Bg6 11. h4 h6 12. Ne5 O-O-O 13. Nxg6 fxg6
14. h5 g5 15. f4 gxf4 16. Rdf1 Ne5 17. dxe5 Qxe5 0-1`;

db.prepare(`
  INSERT INTO games (username, chesscom_url, pgn, time_class, end_time, white, black,
    white_rating, black_rating, result, player_color, player_result, eco, opening_name)
  VALUES (?, ?, ?, 'rapid', strftime('%s','now'), 'testuser', 'opponent', 1200, 1200, '0-1', 'white', 'loss', 'B01', 'Scandinavian Defense')
`).run('testuser', 'local-test-game-2', pgn);

console.log('Seeded game id:', db.prepare('SELECT id FROM games WHERE chesscom_url = ?').get('local-test-game-2').id);

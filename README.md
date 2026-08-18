# ChessCoach — Personalized Chess Improvement App

Analyze your chess.com games, turn your own blunders into custom puzzles, train
tactics, and follow a lesson plan built around your actual weaknesses.

## Features

- **Chess.com sync** — pull your recent games via the chess.com public API (no login required, just your username).
- **Game analyzer** — replay any game on a board with a live evaluation bar; a full Stockfish (WASM, runs in your browser) pass classifies every move as best / good / inaccuracy / mistake / blunder.
- **Custom puzzles** — save any of your blunders as a puzzle with one click; the "correct" move is Stockfish's top recommendation from that exact position.
- **Curated puzzle trainer** — a themed tactics set (forks, pins, back-rank, endgames, etc.) to supplement your own mistakes.
- **Personalized lessons** — a curated library (tactics, openings, endgames, strategy, mindset) with recommendations driven by a weakness profile computed from your blunder themes and puzzle performance.

## Stack

- **Frontend:** React (Vite), react-router, chess.js, react-chessboard, Stockfish 18 (WASM, single-threaded build, runs entirely client-side in a Web Worker — no server-side engine needed).
- **Backend:** Node.js + Express, SQLite (via `better-sqlite3`) for storing synced games, per-move analysis, custom puzzles, and weakness profiles.

## Getting started

```bash
npm run install:all   # installs root, server, and client dependencies
npm run dev            # runs the API (port 4000) and the Vite dev server (port 5173) together
```

Then open http://localhost:5173, enter a chess.com username, and click **Connect** →
**Sync recent games**.

If you're testing without outbound access to chess.com, seed a sample game instead:

```bash
node server/scripts/seed-test-game.js   # inserts one game for user "testuser"
```

Then open the app and connect as `testuser` to try the Analyzer/Puzzles/Lessons flow.

### Run separately

```bash
npm run dev:server   # API only, http://localhost:4000
npm run dev:client   # frontend only, http://localhost:5173
```

### Production build

```bash
npm run build   # builds the client into client/dist
npm start        # serves the API (add a static file server / reverse proxy for client/dist in production)
```

## How the pieces fit together

1. **Dashboard** — link a chess.com username, view rating/record, sync games, see your top weakness themes.
2. **Analyzer** — pick a synced game, run a full Stockfish pass (runs locally in your browser, no API costs), review classified moves, save blunders as puzzles.
3. **Puzzles** — solve puzzles generated from your own games or from the curated set; attempts are tracked per theme.
4. **Lessons** — browse a curated curriculum; lessons matching your weakest themes are surfaced first, based on a profile recomputed from your blunders and puzzle results.

## Notes

- The chess.com public API (`api.chess.com/pub`) requires no authentication, just a descriptive `User-Agent`, which the server sets.
- Stockfish runs fully client-side via WebAssembly — there's no engine cost or latency from a server round trip, and analysis works offline once the app is loaded.
- Data is stored locally in `server/data/chess.db` (SQLite, gitignored). Swap in Postgres later by replacing `server/src/db/index.js` if you need multi-instance deployment.

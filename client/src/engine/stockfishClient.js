/**
 * Thin wrapper around the Stockfish WASM worker. One worker is reused for
 * the whole session; requests are queued so only one FEN is analyzed at a time.
 */
let worker = null;
let ready = false;
let queue = [];
let current = null;

function getWorker() {
  if (worker) return worker;
  worker = new Worker('/engine/stockfish-18-lite-single.js');
  worker.onmessage = (e) => handleMessage(typeof e.data === 'string' ? e.data : e.data?.data);
  worker.postMessage('uci');
  return worker;
}

function handleMessage(line) {
  if (!line) return;
  if (line === 'uciok') {
    getWorker().postMessage('isready');
    return;
  }
  if (line === 'readyok') {
    ready = true;
    pump();
    return;
  }
  if (!current) return;

  if (line.startsWith('info') && line.includes(' pv ')) {
    const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
    const pvMatch = line.match(/ pv (.+)/);
    if (scoreMatch) {
      const [, kind, val] = scoreMatch;
      current.lastEval = kind === 'mate' ? { mate: Number(val) } : { cp: Number(val) };
    }
    if (pvMatch) current.lastPv = pvMatch[1].trim().split(' ');
  }

  if (line.startsWith('bestmove')) {
    const bestMove = line.split(' ')[1];
    const result = { bestMove, evaluation: current.lastEval || null, pv: current.lastPv || [] };
    current.resolve(result);
    current = null;
    pump();
  }
}

function pump() {
  if (!ready || current || queue.length === 0) return;
  current = queue.shift();
  const w = getWorker();
  w.postMessage(`position fen ${current.fen}`);
  w.postMessage(`go depth ${current.depth}`);
}

/**
 * Analyze a FEN position. Returns { bestMove, evaluation: {cp|mate}, pv }.
 * Evaluation is always from White's perspective (positive = White is better).
 */
export function analyzeFen(fen, { depth = 14 } = {}) {
  getWorker();
  return new Promise((resolve) => {
    const turn = fen.split(' ')[1]; // 'w' or 'b'
    queue.push({
      fen,
      depth,
      resolve: (raw) => {
        // Stockfish reports score relative to the side to move; normalize to White's perspective.
        let evaluation = raw.evaluation;
        if (evaluation && turn === 'b') {
          evaluation = evaluation.cp !== undefined ? { cp: -evaluation.cp } : { mate: -evaluation.mate };
        }
        resolve({ ...raw, evaluation });
      },
    });
    pump();
  });
}

export function terminateEngine() {
  if (worker) {
    worker.terminate();
    worker = null;
    ready = false;
    queue = [];
    current = null;
  }
}

/**
 * Thin wrapper around the Stockfish WASM worker. One worker is reused for
 * the whole session; requests are queued so only one FEN is analyzed at a time.
 */
let worker = null;
let ready = false;
let queue = [];
let current = null;
let currentMultiPv = 1;

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
    const multipvMatch = line.match(/multipv (\d+)/);
    const rank = multipvMatch ? Number(multipvMatch[1]) : 1;
    if (scoreMatch && pvMatch) {
      const [, kind, val] = scoreMatch;
      current.lines[rank] = {
        evaluation: kind === 'mate' ? { mate: Number(val) } : { cp: Number(val) },
        pv: pvMatch[1].trim().split(' '),
      };
    }
  }

  if (line.startsWith('bestmove')) {
    const bestMove = line.split(' ')[1];
    const top = current.lines[1] || {};
    const orderedLines = Object.keys(current.lines)
      .map(Number)
      .sort((a, b) => a - b)
      .map((rank) => current.lines[rank]);
    const result = { bestMove, evaluation: top.evaluation || null, pv: top.pv || [], lines: orderedLines };
    current.resolve(result);
    current = null;
    pump();
  }
}

function pump() {
  if (!ready || current || queue.length === 0) return;
  current = queue.shift();
  const w = getWorker();
  if (current.multipv !== currentMultiPv) {
    w.postMessage(`setoption name MultiPV value ${current.multipv}`);
    currentMultiPv = current.multipv;
  }
  w.postMessage(`position fen ${current.fen}`);
  w.postMessage(`go depth ${current.depth}`);
}

/**
 * Analyze a FEN position. Returns { bestMove, evaluation: {cp|mate}, pv, lines }.
 * `lines` holds up to `multipv` candidate moves ranked best-first, each as
 * { evaluation, pv }. Evaluations are always from White's perspective
 * (positive = White is better).
 */
export function analyzeFen(fen, { depth = 14, multipv = 1 } = {}) {
  getWorker();
  return new Promise((resolve) => {
    const turn = fen.split(' ')[1]; // 'w' or 'b'
    queue.push({
      fen,
      depth,
      multipv,
      lines: {},
      resolve: (raw) => {
        // Stockfish reports scores relative to the side to move; normalize to White's perspective.
        const flip = (evaluation) => {
          if (!evaluation || turn !== 'b') return evaluation;
          return evaluation.cp !== undefined ? { cp: -evaluation.cp } : { mate: -evaluation.mate };
        };
        resolve({
          ...raw,
          evaluation: flip(raw.evaluation),
          lines: raw.lines.map((l) => ({ ...l, evaluation: flip(l.evaluation) })),
        });
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
    currentMultiPv = 1;
  }
}

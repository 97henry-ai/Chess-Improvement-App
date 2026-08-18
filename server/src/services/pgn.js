/** Minimal PGN header parser — pulls tag pairs like [White "name"] without a full chess engine. */
export function parsePgnHeaders(pgn) {
  const headers = {};
  const re = /\[(\w+)\s+"([^"]*)"\]/g;
  let m;
  while ((m = re.exec(pgn)) !== null) {
    headers[m[1]] = m[2];
  }
  return headers;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;
  if (!res.ok) throw new Error(body?.error || `Request failed: ${res.status}`);
  return body;
}

export const api = {
  getProfile: (username) => request(`/user/${encodeURIComponent(username)}/profile`),
  getStats: (username) => request(`/user/${encodeURIComponent(username)}/stats`),
  getWeaknessProfile: (username) => request(`/user/${encodeURIComponent(username)}/weakness-profile`),

  syncGames: (username, monthsBack = 3) =>
    request(`/games/${encodeURIComponent(username)}/sync`, {
      method: 'POST',
      body: JSON.stringify({ monthsBack }),
    }),
  getGames: (username, limit = 50) => request(`/games/${encodeURIComponent(username)}?limit=${limit}`),
  getGamesSummary: (username) => request(`/games/${encodeURIComponent(username)}/summary`),
  getPerformance: (username) => request(`/games/${encodeURIComponent(username)}/performance`),
  getGameDetail: (gameId) => request(`/games/detail/${gameId}`),
  saveGameAnalysis: (gameId, moves) =>
    request(`/games/detail/${gameId}/analysis`, { method: 'POST', body: JSON.stringify({ moves }) }),

  getCustomPuzzles: (username) => request(`/puzzles/${encodeURIComponent(username)}/custom`),
  saveCustomPuzzle: (username, puzzle) =>
    request(`/puzzles/${encodeURIComponent(username)}/custom`, { method: 'POST', body: JSON.stringify(puzzle) }),
  getDailyPuzzles: (username, near) => {
    const qs = near !== undefined && near !== null ? `?near=${near}` : '';
    return request(`/puzzles/${encodeURIComponent(username)}/daily${qs}`);
  },
  getCuratedPuzzles: ({ theme, near } = {}) => {
    const qs = new URLSearchParams();
    if (theme) qs.set('theme', theme);
    if (near !== undefined && near !== null) qs.set('near', near);
    const s = qs.toString();
    return request(`/puzzles/curated${s ? `?${s}` : ''}`);
  },
  recordPuzzleAttempt: (puzzleId, username, correct) =>
    request(`/puzzles/${puzzleId}/attempt`, { method: 'POST', body: JSON.stringify({ username, correct }) }),
  getPuzzleStats: (username) => request(`/puzzles/${encodeURIComponent(username)}/stats`),

  getLessons: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/lessons${qs ? `?${qs}` : ''}`);
  },
  getLesson: (id) => request(`/lessons/${id}`),
  recomputeWeaknessProfile: (username) =>
    request(`/lessons/${encodeURIComponent(username)}/recompute`, { method: 'POST' }),
};

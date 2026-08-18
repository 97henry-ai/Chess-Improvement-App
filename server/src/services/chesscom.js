const BASE = 'https://api.chess.com/pub';

// chess.com requires a descriptive User-Agent identifying the app/contact.
const HEADERS = {
  'User-Agent': 'ChessImprovementApp/1.0 (personal project; contact: 97.henry@gmail.com)',
};

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const err = new Error(`chess.com API error ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function getProfile(username) {
  return getJson(`${BASE}/player/${encodeURIComponent(username)}`);
}

export async function getStats(username) {
  return getJson(`${BASE}/player/${encodeURIComponent(username)}/stats`);
}

export async function getArchivesList(username) {
  const data = await getJson(`${BASE}/player/${encodeURIComponent(username)}/games/archives`);
  return data.archives || [];
}

export async function getGamesFromArchive(archiveUrl) {
  const data = await getJson(archiveUrl);
  return data.games || [];
}

/** Fetch the most recent N months of archives (newest first). */
export async function getRecentGames(username, monthsBack = 3) {
  const archives = await getArchivesList(username);
  const recent = archives.slice(-monthsBack).reverse();
  const allGames = [];
  for (const url of recent) {
    const games = await getGamesFromArchive(url);
    allGames.push(...games);
  }
  return allGames;
}

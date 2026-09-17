/**
 * DVR Wheel TV metadata Worker
 * Primary source: TVmaze public API
 * Fallback chain: TVmaze -> EpisoDate -> TMDB -> TheTVDB (when configured).
 *
 * Routes:
 *   GET  /health
 *   GET  /api/search?q=Show%20Name
 *   POST /api/discover               { date: "YYYY-MM-DD", shows: [...] }
 *   POST /api/franchise-candidates   { franchises: [...], trackedIds: [...] }
 */

const APP = "DVR Wheel TV Bridge";
const VERSION = "0.2.14";
const TVMAZE = "https://api.tvmaze.com";
const UA = "DVR-Wheel/0.2.12";
const EPISODATE = "https://www.episodate.com/api";
const TVDB = "https://api4.thetvdb.com/v4";
const TMDB = "https://api.themoviedb.org/3";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({
          ok: true,
          app: APP,
          version: VERSION,
          tvmaze: true,
          catchUp: true,
          franchiseWatch: true,
          episodateFallback: true,
          exactShowLock: true,
          rollingRecheckDays: 3,
          providerReconciliation: true,
          providerIdentityValidation: true,
          providerConsensus: true,
          initialBackfill: true,
          strictProviderAirdate: true,
          reviewedBroadcastGuard: true,
          yesterdayOnlyGuard: true,
          tmdbSeriesPointerRecovery: true,
          tmdbFallback: Boolean(env?.TMDB_API_KEY || env?.TMDB_READ_TOKEN),
          tvdbFallback: Boolean(env?.TVDB_API_KEY),
          tvdbAttribution: true
        });
      }

      if (url.pathname === "/api/search" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        if (!q) return json({ ok: false, error: "Missing q" }, 400);
        const results = await combinedSearch(q, env);
        return json({ ok: true, results });
      }

      if (url.pathname === "/api/discover" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        const date = String(body?.date || "");
        const maxAirdate = String(body?.maxAirdate || "");
        const shows = Array.isArray(body?.shows) ? body.shows.slice(0, 100) : [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: "Invalid date" }, 400);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(maxAirdate)) return json({ ok: false, error: "Missing or invalid maxAirdate" }, 400);
        if (date > maxAirdate) return json({ ok: false, error: `Requested date ${date} is newer than allowed ${maxAirdate}` }, 400);
        if (!shows.length) return json({ ok: true, date, episodes: [], resolvedShows: [] });

        const result = await discover(date, shows, env);
        return json({ ok: true, date, ...result });
      }

      if (url.pathname === "/api/backfill" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        const show = body?.show && typeof body.show === "object" ? body.show : null;
        if (!show?.title) return json({ ok: false, error: "Missing show" }, 400);
        const result = await backfillShow(show, env);
        return json({ ok: true, ...result });
      }

      if (url.pathname === "/api/franchise-candidates" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        const franchises = Array.isArray(body?.franchises) ? body.franchises.slice(0, 25) : [];
        const trackedIds = new Set((Array.isArray(body?.trackedIds) ? body.trackedIds : []).map(Number).filter(Boolean));
        const candidates = await discoverFranchiseCandidates(franchises, trackedIds, env);
        return json({ ok: true, candidates });
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      return json({ ok: false, error: error?.message || "Unexpected error" }, 500);
    }
  }
};

async function tvmazeFetch(path) {
  const r = await fetch(`${TVMAZE}${path}`, { headers: { "User-Agent": UA } });
  if (!r.ok) {
    if (r.status === 404) return null;
    throw new Error(`TVmaze request failed (${r.status})`);
  }
  return await r.json();
}

async function tvmazeSearch(q) {
  const data = await tvmazeFetch(`/search/shows?q=${encodeURIComponent(q)}`) || [];
  return data.slice(0, 8).map(({ score, show }) => summarizeShow(show, score));
}

function summarizeShow(show, score = null) {
  return {
    id: show.id,
    name: show.name,
    premiered: show.premiered || null,
    ended: show.ended || null,
    status: show.status || null,
    network: show.network?.name || show.webChannel?.name || null,
    country: show.network?.country?.code || show.webChannel?.country?.code || null,
    genres: Array.isArray(show.genres) ? show.genres : [],
    score
  };
}




async function tmdbFetch(path, env) {
  const apiKey = String(env?.TMDB_API_KEY || "").trim();
  const readToken = String(env?.TMDB_READ_TOKEN || "").trim();
  if (!apiKey && !readToken) return null;
  const joiner = path.includes("?") ? "&" : "?";
  const url = apiKey ? `${TMDB}${path}${joiner}api_key=${encodeURIComponent(apiKey)}` : `${TMDB}${path}`;
  const headers = { "Accept": "application/json", "User-Agent": UA };
  if (readToken) headers.Authorization = `Bearer ${readToken}`;
  const r = await fetch(url, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`TMDB request failed (${r.status})`);
  return await r.json();
}

async function tmdbSearch(q, env) {
  if (!env?.TMDB_API_KEY && !env?.TMDB_READ_TOKEN) return [];
  const data = await tmdbFetch(`/search/tv?query=${encodeURIComponent(q)}&include_adult=false&language=en-US&page=1`, env).catch(() => null);
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows.slice(0, 10).map(row => ({
    id: `tmdb:${row.id}`,
    tmdbId: Number(row.id),
    source: "tmdb",
    name: row.name || row.original_name || q,
    premiered: row.first_air_date || null,
    ended: null,
    status: null,
    network: null,
    country: Array.isArray(row.origin_country) ? (row.origin_country[0] || null) : null,
    popularity: row.popularity || 0
  })).filter(x => x.tmdbId);
}

async function tmdbExactTitle(title, env) {
  const wanted = normalize(title);
  const rows = await tmdbSearch(title, env).catch(() => []);
  return rows.find(x => normalize(x.name) === wanted) || null;
}

async function tmdbEpisodesByDate(seriesId, date, env) {
  if (!seriesId || (!env?.TMDB_API_KEY && !env?.TMDB_READ_TOKEN)) return [];
  const details = await tmdbFetch(`/tv/${encodeURIComponent(seriesId)}?language=en-US`, env).catch(() => null);
  if (!details) return [];

  const seasonNumbers = new Set();
  const lastSeason = Number(details?.last_episode_to_air?.season_number);
  const nextSeason = Number(details?.next_episode_to_air?.season_number);
  if (Number.isFinite(lastSeason)) {
    seasonNumbers.add(lastSeason);
    if (lastSeason > 0) seasonNumbers.add(lastSeason - 1);
  }
  if (Number.isFinite(nextSeason)) seasonNumbers.add(nextSeason);

  // If TMDB already says the latest/next episode is on the requested date, use its season.
  for (const ep of [details?.last_episode_to_air, details?.next_episode_to_air]) {
    if (String(ep?.air_date || "").slice(0, 10) === date && Number.isFinite(Number(ep?.season_number))) {
      seasonNumbers.add(Number(ep.season_number));
    }
  }

  // Fall back to the newest few ordinary seasons if current episode pointers are absent.
  if (!seasonNumbers.size && Array.isArray(details?.seasons)) {
    for (const season of details.seasons.slice().sort((a,b) => Number(b.season_number)-Number(a.season_number)).slice(0,3)) {
      if (Number(season.season_number) >= 0) seasonNumbers.add(Number(season.season_number));
    }
  }

  const found = [];

  // TMDB's series-level last/next episode pointers are sometimes updated before
  // the season episode list, especially for daily/syndicated shows. Treat those
  // pointers as first-class provider metadata when their own air_date matches the
  // requested date. This recovers episodes such as Wheel of Fortune without ever
  // inventing/stamping the queried date onto an episode.
  for (const ep of [details?.last_episode_to_air, details?.next_episode_to_air]) {
    if (ep && String(ep.air_date || "").slice(0, 10) === date) found.push(ep);
  }

  for (const seasonNumber of [...seasonNumbers].slice(0, 4)) {
    const season = await tmdbFetch(`/tv/${encodeURIComponent(seriesId)}/season/${encodeURIComponent(seasonNumber)}?language=en-US`, env).catch(() => null);
    const eps = Array.isArray(season?.episodes) ? season.episodes : [];
    for (const ep of eps) if (String(ep?.air_date || "").slice(0, 10) === date) found.push(ep);
  }

  // The same TMDB episode may now be present through both the series pointer and
  // season list. Collapse it before provider reconciliation.
  const unique = new Map();
  for (const ep of found) {
    const key = `${ep.id || ""}|${ep.season_number ?? ""}|${ep.episode_number ?? ""}|${String(ep.air_date || "").slice(0,10)}`;
    unique.set(key, ep);
  }
  return [...unique.values()];
}

function normalizeTmdbEpisode(ep, showName, trackedTitle, seriesId) {
  return {
    id: `tmdb:${seriesId}:${ep.id || ""}:${ep.season_number ?? ""}:${ep.episode_number ?? ""}:${ep.air_date || ""}`,
    kind: "episode",
    source: "tmdb",
    trackedTitle,
    show: showName || trackedTitle,
    season: ep.season_number ?? null,
    number: ep.episode_number ?? null,
    title: ep.name || null,
    airdate: String(ep.air_date || "").slice(0, 10) || null
  };
}

let tvdbTokenCache = { token: null, expiresAt: 0 };

async function tvdbToken(env) {
  const apiKey = String(env?.TVDB_API_KEY || "").trim();
  if (!apiKey) return null;
  if (tvdbTokenCache.token && Date.now() < tvdbTokenCache.expiresAt) return tvdbTokenCache.token;
  const r = await fetch(`${TVDB}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ apikey: apiKey })
  });
  if (!r.ok) throw new Error(`TheTVDB login failed (${r.status})`);
  const data = await r.json();
  const token = data?.data?.token;
  if (!token) throw new Error("TheTVDB login returned no token");
  // Official tokens last one month. Refresh a little early.
  tvdbTokenCache = { token, expiresAt: Date.now() + 27 * 24 * 60 * 60 * 1000 };
  return token;
}

async function tvdbFetch(path, env) {
  const token = await tvdbToken(env);
  if (!token) return null;
  const r = await fetch(`${TVDB}${path}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json", "User-Agent": UA }
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`TheTVDB request failed (${r.status})`);
  return await r.json();
}

function tvdbName(row) {
  return row?.name || row?.name_translated || row?.translations?.eng || row?.title || null;
}

async function tvdbSearch(q, env) {
  if (!env?.TVDB_API_KEY) return [];
  const data = await tvdbFetch(`/search?query=${encodeURIComponent(q)}&type=series`, env).catch(() => null);
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.slice(0, 10).map(row => {
    const rawId = row.tvdb_id ?? row.tvdbId ?? row.id ?? row.objectID;
    const id = Number(String(rawId || "").replace(/[^0-9]/g, "")) || null;
    return {
      id: id ? `tvdb:${id}` : null,
      tvdbId: id,
      source: "tvdb",
      name: tvdbName(row) || q,
      premiered: row.year ? `${row.year}-01-01` : (row.first_air_time || null),
      ended: null,
      status: row.status || null,
      network: Array.isArray(row.companies) ? (row.companies[0]?.name || null) : null,
      country: row.country || row.primary_language || null
    };
  }).filter(x => x.tvdbId);
}

async function tvdbExactTitle(title, env) {
  const wanted = normalize(title);
  const rows = await tvdbSearch(title, env).catch(() => []);
  return rows.find(x => normalize(x.name) === wanted) || null;
}

async function tvdbEpisodesByDate(seriesId, date, env) {
  if (!seriesId || !env?.TVDB_API_KEY) return [];
  const found = [];
  // TheTVDB paginates series episodes. Five pages is intentionally conservative for
  // this fallback; most current shows resolve on the first page, and we only call it
  // after TVmaze and EpisoDate find nothing for the requested day.
  for (let page = 0; page < 5; page++) {
    const data = await tvdbFetch(`/series/${encodeURIComponent(seriesId)}/episodes/default/eng?page=${page}`, env).catch(() => null)
      || await tvdbFetch(`/series/${encodeURIComponent(seriesId)}/episodes/default?page=${page}`, env).catch(() => null);
    if (!data) break;
    const eps = Array.isArray(data?.data?.episodes) ? data.data.episodes
      : Array.isArray(data?.data) ? data.data
      : Array.isArray(data?.episodes) ? data.episodes : [];
    for (const ep of eps) {
      const aired = String(ep?.aired || ep?.airDate || ep?.firstAired || "").slice(0, 10);
      if (aired === date) found.push(ep);
    }
    const next = data?.links?.next ?? data?.data?.links?.next;
    if (next === null || next === undefined || next === "") {
      if (eps.length < 50) break;
    }
    if (!eps.length) break;
  }
  return found;
}

function normalizeTvdbEpisode(ep, showName, trackedTitle, seriesId) {
  return {
    id: `tvdb:${ep.id || seriesId}:${ep.seasonNumber ?? ep.season ?? ""}:${ep.number ?? ep.episodeNumber ?? ""}:${ep.aired || ep.airDate || ""}`,
    kind: "episode",
    source: "tvdb",
    trackedTitle,
    show: showName || trackedTitle,
    season: ep.seasonNumber ?? ep.season ?? null,
    number: ep.number ?? ep.episodeNumber ?? null,
    title: ep.name || null,
    airdate: String(ep.aired || ep.airDate || ep.firstAired || "").slice(0, 10) || null
  };
}

async function episodateFetch(path) {
  const r = await fetch(`${EPISODATE}${path}`, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`EpisoDate request failed (${r.status})`);
  return await r.json();
}

async function episodateSearch(q) {
  const data = await episodateFetch(`/search?q=${encodeURIComponent(q)}&page=1`).catch(() => null);
  const rows = Array.isArray(data?.tv_shows) ? data.tv_shows : [];
  return rows.slice(0, 10).map(show => ({
    id: `episodate:${show.id}`,
    episodateId: Number(show.id),
    source: "episodate",
    name: show.name,
    premiered: show.start_date || null,
    ended: show.end_date || null,
    status: show.status || null,
    network: show.network || null,
    country: show.country || null,
    permalink: show.permalink || null
  }));
}

async function episodateDetails(id) {
  const data = await episodateFetch(`/show-details?q=${encodeURIComponent(id)}`).catch(() => null);
  return data?.tvShow || null;
}

async function combinedSearch(q, env) {
  const [maze, epi, tmdb, tvdb] = await Promise.all([
    tvmazeSearch(q).catch(() => []),
    episodateSearch(q).catch(() => []),
    tmdbSearch(q, env).catch(() => []),
    tvdbSearch(q, env).catch(() => [])
  ]);
  const wanted = normalize(q);
  const rows = [];
  for (const item of maze) rows.push({ ...item, source: "tvmaze", tvmazeId: Number(item.id), id: `tvmaze:${item.id}` });
  for (const item of epi) rows.push(item);
  for (const item of tmdb) rows.push(item);
  for (const item of tvdb) rows.push(item);

  // Exact-name matches first, then U.S. results, then the provider's own order.
  rows.sort((a, b) => {
    const ae = normalize(a.name) === wanted ? 1 : 0;
    const be = normalize(b.name) === wanted ? 1 : 0;
    if (ae !== be) return be - ae;
    const au = String(a.country || "").toUpperCase() === "US" || String(a.country || "").toLowerCase().includes("united states") ? 1 : 0;
    const bu = String(b.country || "").toUpperCase() === "US" || String(b.country || "").toLowerCase().includes("united states") ? 1 : 0;
    if (au !== bu) return bu - au;
    return 0;
  });

  // Same provider/show identity only. Do not collapse same-name shows from two providers,
  // because that second identity is useful as a fallback if one database is incomplete.
  const seen = new Set();
  return rows.filter(item => {
    const key = item.source === "tvmaze" ? `m:${item.tvmazeId}` : item.source === "episodate" ? `e:${item.episodateId}` : item.source === "tmdb" ? `tm:${item.tmdbId}` : `t:${item.tvdbId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

async function tvmazeIdentity(showId) {
  if (!showId) return null;
  const show = await tvmazeFetch(`/shows/${encodeURIComponent(showId)}`).catch(() => null);
  if (!show) return null;
  return {
    name: show.name || null,
    network: show.network?.name || show.webChannel?.name || null,
    country: show.network?.country?.code || show.webChannel?.country?.code || null,
    premiered: show.premiered || null
  };
}

function normalizedCountry(value) {
  const v = normalize(value);
  if (!v) return "";
  if (["us", "usa", "united states", "united states of america"].includes(v)) return "us";
  if (["gb", "uk", "united kingdom", "great britain"].includes(v)) return "gb";
  if (["ca", "canada"].includes(v)) return "ca";
  if (["au", "australia"].includes(v)) return "au";
  return v;
}

function identityScore(candidate, hints = {}) {
  let score = 0;
  const hc = normalizedCountry(hints.country);
  const cc = normalizedCountry(candidate?.country);
  if (hc && cc) score += hc === cc ? 8 : -20;

  const hn = normalize(hints.network);
  const cn = normalize(candidate?.network);
  if (hn && cn) score += hn === cn ? 5 : -2;

  const hy = Number(String(hints.premiered || "").slice(0, 4)) || 0;
  const cy = Number(String(candidate?.premiered || "").slice(0, 4)) || 0;
  if (hy && cy) {
    const gap = Math.abs(hy - cy);
    score += gap === 0 ? 4 : gap <= 1 ? 2 : gap >= 4 ? -3 : 0;
  }
  return score;
}

function bestExact(rows, title, hints = {}) {
  const wanted = normalize(title);
  const exact = rows.filter(x => normalize(x.name) === wanted);
  if (!exact.length) return null;
  return exact.slice().sort((a, b) => identityScore(b, hints) - identityScore(a, hints))[0] || null;
}

async function validateEpisodateIdentity(id, title, hints = {}) {
  if (!id) return false;
  const details = await episodateDetails(id).catch(() => null);
  if (!details) return false;
  if (normalize(details.name) !== normalize(title)) return false;
  const candidate = {
    name: details.name,
    network: details.network || null,
    country: details.country || null,
    premiered: details.start_date || null
  };
  // Strong country disagreement is enough to reject a stale/wrong exact-title lock.
  const hc = normalizedCountry(hints.country);
  const cc = normalizedCountry(candidate.country);
  if (hc && cc && hc !== cc) return false;
  return true;
}

async function resolveExactTitle(title, env, hints = {}) {
  const [maze, epi, tmdb, tvdb] = await Promise.all([
    tvmazeSearch(title).catch(() => []),
    episodateSearch(title).catch(() => []),
    tmdbSearch(title, env).catch(() => []),
    tvdbSearch(title, env).catch(() => [])
  ]);
  const exactMaze = bestExact(maze, title, hints);
  const exactEpi = bestExact(epi, title, hints);
  const exactTmdb = bestExact(tmdb, title, hints);
  const exactTvdb = bestExact(tvdb, title, hints);
  return {
    tvmaze: exactMaze ? { id: Number(exactMaze.id), name: exactMaze.name } : null,
    episodate: exactEpi ? { id: Number(exactEpi.episodateId), name: exactEpi.name } : null,
    tmdb: exactTmdb ? { id: Number(exactTmdb.tmdbId), name: exactTmdb.name } : null,
    tvdb: exactTvdb ? { id: Number(exactTvdb.tvdbId), name: exactTvdb.name } : null
  };
}

async function episodateEpisodesByDate(showId, date) {
  const details = await episodateDetails(showId);
  const eps = Array.isArray(details?.episodes) ? details.episodes : [];
  return eps.filter(ep => String(ep.air_date || "").slice(0, 10) === date);
}

function normalizeEpisodateEpisode(ep, showName, trackedTitle, showId) {
  return {
    id: `episodate:${showId}:${ep.season ?? ""}:${ep.episode ?? ""}:${ep.air_date || ""}`,
    kind: "episode",
    source: "episodate",
    trackedTitle,
    show: showName || trackedTitle,
    season: ep.season ?? null,
    number: ep.episode ?? null,
    title: ep.name || null,
    airdate: String(ep.air_date || "").slice(0, 10) || null
  };
}

async function tvmazeResolve(title) {
  const results = await tvmazeSearch(title);
  if (!results.length) return null;
  const norm = normalize(title);
  return results.find(x => normalize(x.name) === norm) || results[0];
}

async function tvmazeEpisodesByDate(showId, date) {
  return await tvmazeFetch(`/shows/${encodeURIComponent(showId)}/episodesbydate?date=${encodeURIComponent(date)}`) || [];
}

async function tvmazeScheduleByDate(date) {
  return await tvmazeFetch(`/schedule?country=US&date=${encodeURIComponent(date)}`) || [];
}

async function tvmazeScheduleEpisodesForShow(schedule, title, showId = null) {
  const wanted = normalize(title);
  return (Array.isArray(schedule) ? schedule : []).filter(ep => {
    const sid = Number(ep?.show?.id);
    if (showId && sid === Number(showId)) return true;
    return normalize(ep?.show?.name) === wanted;
  });
}

async function discover(date, shows, env) {
  const episodes = [];
  const resolvedShows = [];
  let schedule = [];
  try { schedule = await tvmazeScheduleByDate(date); } catch { schedule = []; }

  for (const raw of shows) {
    const title = String(raw?.title || "").trim();
    if (!title) continue;

    let mazeId = Number(raw?.tvmazeId) || null;
    let epiId = Number(raw?.episodateId) || null;
    let tmdbId = Number(raw?.tmdbId) || null;
    let tvdbId = Number(raw?.tvdbId) || null;
    let canonicalName = String(raw?.canonicalName || title);

    // Use the exact TVmaze identity, when available, as the cross-provider anchor.
    // This prevents exact-title collisions such as international versions of Big Brother.
    const anchor = mazeId ? await tvmazeIdentity(mazeId) : null;
    const hints = {
      country: anchor?.country || raw?.country || null,
      network: anchor?.network || raw?.network || null,
      premiered: anchor?.premiered || raw?.premiered || null
    };
    if (anchor?.name) canonicalName = anchor.name;

    // Existing EpisoDate IDs from older builds may have been attached by title alone.
    // Reject an identity that conflicts with the anchored country, then re-resolve it.
    if (epiId && anchor) {
      const valid = await validateEpisodateIdentity(epiId, canonicalName || title, hints);
      if (!valid) epiId = null;
    }

    // Never use a fuzzy first-result fallback for an already tracked show.
    // Missing provider identities are bound only to exact titles, ranked by country/network/year.
    if (!mazeId || !epiId || (!tmdbId && (env?.TMDB_API_KEY || env?.TMDB_READ_TOKEN)) || (!tvdbId && env?.TVDB_API_KEY)) {
      const exact = await resolveExactTitle(canonicalName || title, env, hints);
      if (!mazeId && exact.tvmaze?.id) mazeId = exact.tvmaze.id;
      if (!epiId && exact.episodate?.id) epiId = exact.episodate.id;
      if (!tmdbId && exact.tmdb?.id) tmdbId = exact.tmdb.id;
      if (!tvdbId && exact.tvdb?.id) tvdbId = exact.tvdb.id;
      canonicalName = exact.tvmaze?.name || exact.episodate?.name || exact.tmdb?.name || exact.tvdb?.name || canonicalName;
    }

    // Query every configured provider for the requested date. The older strict fallback
    // chain stopped as soon as one provider returned anything, which let a stale EpisoDate
    // record mask a correct TMDB episode. v0.2.6 reconciles before surfacing results.
    let mazeEpisodes = [], epiEpisodes = [], tmdbEpisodes = [], tvdbEpisodes = [];
    if (mazeId) {
      try { mazeEpisodes = await tvmazeEpisodesByDate(mazeId, date); } catch { mazeEpisodes = []; }
    }
    if (!mazeEpisodes.length && schedule.length) {
      mazeEpisodes = await tvmazeScheduleEpisodesForShow(schedule, canonicalName || title, mazeId);
    }
    if (epiId) {
      try { epiEpisodes = await episodateEpisodesByDate(epiId, date); } catch { epiEpisodes = []; }
    }
    if (tmdbId && (env?.TMDB_API_KEY || env?.TMDB_READ_TOKEN)) {
      try { tmdbEpisodes = await tmdbEpisodesByDate(tmdbId, date, env); } catch { tmdbEpisodes = []; }
    }
    if (tvdbId && env?.TVDB_API_KEY) {
      try { tvdbEpisodes = await tvdbEpisodesByDate(tvdbId, date, env); } catch { tvdbEpisodes = []; }
    }

    // A provider result is eligible only when the provider's own stored airdate
    // exactly matches the requested broadcast date. Never infer/stamp the query date.
    const normalized = {
      tvmaze: mazeEpisodes.map(ep => normalizeMazeEpisode(ep, { id: mazeId, name: canonicalName }, title)),
      episodate: epiEpisodes.map(ep => normalizeEpisodateEpisode(ep, canonicalName, title, epiId)),
      tmdb: tmdbEpisodes.map(ep => normalizeTmdbEpisode(ep, canonicalName, title, tmdbId)),
      tvdb: tvdbEpisodes.map(ep => normalizeTvdbEpisode(ep, canonicalName, title, tvdbId))
    };
    for (const source of Object.keys(normalized)) {
      normalized[source] = normalized[source].filter(ep => ep.airdate === date);
    }

    for (const ep of reconcileProviderEpisodes(normalized)) episodes.push(ep);

    resolvedShows.push({
      title,
      tvmazeId: mazeId,
      episodateId: epiId,
      tmdbId,
      tvdbId,
      canonicalName,
      source: [mazeId ? "tvmaze" : null, epiId ? "episodate" : null, tmdbId ? "tmdb" : null, tvdbId ? "tvdb" : null].filter(Boolean).join("+") || "unresolved"
    });
  }

  return { episodes: dedupeEpisodes(episodes), resolvedShows };
}

function episodeSignature(ep) {
  const s = Number(ep?.season);
  const n = Number(ep?.number);
  if (Number.isFinite(s) && Number.isFinite(n)) return `sn:${s}:${n}`;
  const title = normalize(ep?.title);
  return title ? `t:${title}` : `id:${ep?.id || ""}`;
}

function reconcileProviderEpisodes(groups) {
  const sourceWeight = { tvdb: 4, tmdb: 3, tvmaze: 2, episodate: 1 };
  const activeProviders = Object.entries(groups || {}).filter(([, items]) => Array.isArray(items) && items.length);
  if (activeProviders.length === 1) return dedupeEpisodes(activeProviders[0][1]);
  const all = [];
  for (const [source, items] of Object.entries(groups || {})) {
    for (const ep of items || []) all.push({ ...ep, source: ep.source || source });
  }
  if (!all.length) return [];

  const buckets = new Map();
  for (const ep of all) {
    const sig = episodeSignature(ep);
    const key = `${ep.airdate || ""}|${sig}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(ep);
  }

  const scored = [...buckets.values()].map(items => {
    const providers = new Set(items.map(x => x.source));
    const support = [...providers].reduce((sum, src) => sum + (sourceWeight[src] || 0), 0);
    const best = items.slice().sort((a, b) => (sourceWeight[b.source] || 0) - (sourceWeight[a.source] || 0))[0];
    return { items, providers, support, best };
  });

  // If providers disagree about the same broadcast date, use consensus rather than
  // automatically trusting TVmaze. Ties break toward the more authoritative keyed source.
  const byDate = new Map();
  for (const row of scored) {
    const date = row.best.airdate || "";
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  }

  const chosen = [];
  for (const rows of byDate.values()) {
    const maxSupport = Math.max(...rows.map(r => r.support));
    const winners = rows.filter(r => r.support === maxSupport);
    winners.sort((a, b) => (sourceWeight[b.best.source] || 0) - (sourceWeight[a.best.source] || 0));

    // Preserve genuine multiple-episode days when several candidates have meaningful
    // independent support; otherwise choose the best-supported numbering for that date.
    const strong = rows.filter(r => r.providers.size >= 2 && r.support >= 3);
    if (strong.length > 1) {
      strong.sort((a, b) => Number(a.best.number || 0) - Number(b.best.number || 0));
      for (const row of strong) chosen.push(row.best);
    } else {
      chosen.push(winners[0].best);
    }
  }
  return dedupeEpisodes(chosen);
}

function normalizeMazeEpisode(ep, resolved, trackedTitle) {
  return {
    id: `tvmaze:${ep.id}`,
    kind: "episode",
    source: "tvmaze",
    trackedTitle,
    show: resolved.name || trackedTitle,
    season: ep.season ?? null,
    number: ep.number ?? null,
    title: ep.name || null,
    airdate: ep.airdate || null
  };
}


function dateDaysAgo(days) {
  const d = new Date();
  d.setHours(12,0,0,0);
  d.setDate(d.getDate() - Number(days || 0));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

async function tvmazeEpisodeHistory(showId) {
  if (!showId) return [];
  return await tvmazeFetch(`/shows/${encodeURIComponent(showId)}/episodes?specials=1`) || [];
}

async function episodateEpisodeHistory(showId) {
  if (!showId) return [];
  const details = await episodateDetails(showId);
  return Array.isArray(details?.episodes) ? details.episodes : [];
}

async function tmdbEpisodeHistory(seriesId, env) {
  if (!seriesId || (!env?.TMDB_API_KEY && !env?.TMDB_READ_TOKEN)) return [];
  const details = await tmdbFetch(`/tv/${encodeURIComponent(seriesId)}?language=en-US`, env).catch(() => null);
  if (!details || !Array.isArray(details.seasons)) return [];
  const seasons = details.seasons
    .filter(x => Number(x.season_number) >= 0)
    .sort((a,b) => Number(b.season_number)-Number(a.season_number))
    .slice(0, 8);
  const out = [];
  for (const row of seasons) {
    const season = await tmdbFetch(`/tv/${encodeURIComponent(seriesId)}/season/${encodeURIComponent(row.season_number)}?language=en-US`, env).catch(() => null);
    if (Array.isArray(season?.episodes)) out.push(...season.episodes);
  }
  return out;
}

async function tvdbEpisodeHistory(seriesId, env) {
  if (!seriesId || !env?.TVDB_API_KEY) return [];
  const out = [];
  for (let page = 0; page < 10; page++) {
    const data = await tvdbFetch(`/series/${encodeURIComponent(seriesId)}/episodes/default/eng?page=${page}`, env).catch(() => null)
      || await tvdbFetch(`/series/${encodeURIComponent(seriesId)}/episodes/default?page=${page}`, env).catch(() => null);
    if (!data) break;
    const eps = Array.isArray(data?.data?.episodes) ? data.data.episodes
      : Array.isArray(data?.data) ? data.data
      : Array.isArray(data?.episodes) ? data.episodes : [];
    out.push(...eps);
    if (!eps.length || eps.length < 50) break;
  }
  return out;
}

async function backfillShow(raw, env) {
  const title = String(raw?.title || "").trim();
  let mazeId = Number(raw?.tvmazeId) || null;
  let epiId = Number(raw?.episodateId) || null;
  let tmdbId = Number(raw?.tmdbId) || null;
  let tvdbId = Number(raw?.tvdbId) || null;
  let canonicalName = String(raw?.canonicalName || title);

  const anchor = mazeId ? await tvmazeIdentity(mazeId).catch(() => null) : null;
  const hints = { country: anchor?.country || raw?.country || null, network: anchor?.network || raw?.network || null, premiered: anchor?.premiered || raw?.premiered || null };
  if (anchor?.name) canonicalName = anchor.name;
  const exact = await resolveExactTitle(canonicalName || title, env, hints);
  if (!mazeId && exact.tvmaze?.id) mazeId = exact.tvmaze.id;
  if (!epiId && exact.episodate?.id) epiId = exact.episodate.id;
  if (!tmdbId && exact.tmdb?.id) tmdbId = exact.tmdb.id;
  if (!tvdbId && exact.tvdb?.id) tvdbId = exact.tvdb.id;

  const [mazeRaw, epiRaw, tmdbRaw, tvdbRaw] = await Promise.all([
    tvmazeEpisodeHistory(mazeId).catch(() => []),
    episodateEpisodeHistory(epiId).catch(() => []),
    tmdbEpisodeHistory(tmdbId, env).catch(() => []),
    tvdbEpisodeHistory(tvdbId, env).catch(() => [])
  ]);
  const normalized = {
    tvmaze: mazeRaw.map(ep => normalizeMazeEpisode(ep, { id: mazeId, name: canonicalName }, title)),
    episodate: epiRaw.map(ep => normalizeEpisodateEpisode(ep, canonicalName, title, epiId)),
    tmdb: tmdbRaw.map(ep => normalizeTmdbEpisode(ep, canonicalName, title, tmdbId)),
    tvdb: tvdbRaw.map(ep => normalizeTvdbEpisode(ep, canonicalName, title, tvdbId))
  };

  const windows = [30, 365, 730, 1825];
  let chosenWindow = windows[windows.length - 1];
  let episodes = [];
  for (const days of windows) {
    const cutoff = dateDaysAgo(days);
    const dates = new Set();
    const upper = dateDaysAgo(1);
    for (const items of Object.values(normalized)) for (const ep of items) if (ep.airdate && ep.airdate >= cutoff && ep.airdate <= upper) dates.add(ep.airdate);
    const found = [];
    for (const date of [...dates].sort()) {
      const groups = {};
      for (const [source, items] of Object.entries(normalized)) groups[source] = items.filter(ep => ep.airdate === date);
      found.push(...reconcileProviderEpisodes(groups));
    }
    if (found.length) {
      episodes = found.sort((a,b) => String(a.airdate).localeCompare(String(b.airdate))).slice(-100);
      chosenWindow = days;
      break;
    }
  }
  return {
    episodes: dedupeEpisodes(episodes),
    windowDays: chosenWindow,
    resolvedShow: { title, canonicalName, tvmazeId: mazeId, episodateId: epiId, tmdbId, tvdbId }
  };
}

async function discoverFranchiseCandidates(franchises, trackedIds, env) {
  const all = new Map();

  for (const raw of franchises) {
    const seedId = Number(raw?.tvmazeId);
    const franchiseTitle = String(raw?.canonicalName || raw?.title || "").trim();
    if (!franchiseTitle) continue;

    if (seedId) {
      const seed = await tvmazeFetch(`/shows/${seedId}`);
      if (seed) {
        const seedYear = Number(String(seed.premiered || "").slice(0, 4)) || 0;
        const seedNetwork = seed.network?.name || seed.webChannel?.name || null;
        const nameMatches = await tvmazeSearch(franchiseTitle);
        for (const match of nameMatches) addCandidate(all, match, franchiseTitle, seedId, trackedIds, 5, seedYear, seedNetwork);

        let cast = [];
        try { cast = await tvmazeFetch(`/shows/${seedId}/cast`) || []; } catch { cast = []; }
        for (const credit of cast.slice(0, 6)) {
          const personId = Number(credit?.person?.id);
          if (!personId) continue;
          let credits = [];
          try { credits = await tvmazeFetch(`/people/${personId}/castcredits?embed=show`) || []; } catch { credits = []; }
          for (const row of credits) {
            const show = row?._embedded?.show;
            if (!show) continue;
            addCandidate(all, summarizeShow(show), franchiseTitle, seedId, trackedIds, 2, seedYear, seedNetwork);
          }
        }
      }
    }

    // Second net: EpisoDate title-family search. This can surface brand-new or
    // revived spinoffs before TVmaze has created an entry for them.
    const epiMatches = await episodateSearch(franchiseTitle).catch(() => []);
    for (const match of epiMatches) {
      if (normalize(match.name) === normalize(franchiseTitle)) continue;
      const key = `${franchiseTitle}|episodate|${match.episodateId}`;
      if (all.has(key)) continue;
      all.set(key, {
        id: `episodate-show:${match.episodateId}:franchise:${normalize(franchiseTitle).replace(/ /g, "-")}`,
        kind: "series-candidate",
        source: "episodate",
        franchiseTitle,
        episodateId: match.episodateId,
        tvmazeId: null,
        show: match.name,
        premiered: match.premiered || null,
        statusText: match.status || null,
        network: match.network || null,
        score: 3
      });
    }

    // Third net: TMDB search, when configured.
    const tmdbMatches = await tmdbSearch(franchiseTitle, env).catch(() => []);
    for (const match of tmdbMatches) {
      if (normalize(match.name) === normalize(franchiseTitle)) continue;
      const key = `${franchiseTitle}|tmdb|${match.tmdbId}`;
      if (all.has(key)) continue;
      all.set(key, {
        id: `tmdb-show:${match.tmdbId}:franchise:${normalize(franchiseTitle).replace(/ /g, "-")}`,
        kind: "series-candidate",
        source: "tmdb",
        franchiseTitle,
        tmdbId: match.tmdbId,
        tvdbId: null,
        episodateId: null,
        tvmazeId: null,
        show: match.name,
        premiered: match.premiered || null,
        statusText: match.status || null,
        network: match.network || null,
        score: 3
      });
    }

    // Fourth net: TheTVDB search, when configured. This is especially useful for
    // brand-new spinoffs that have not propagated to the other providers yet.
    const tvdbMatches = await tvdbSearch(franchiseTitle, env).catch(() => []);
    for (const match of tvdbMatches) {
      if (normalize(match.name) === normalize(franchiseTitle)) continue;
      const key = `${franchiseTitle}|tvdb|${match.tvdbId}`;
      if (all.has(key)) continue;
      all.set(key, {
        id: `tvdb-show:${match.tvdbId}:franchise:${normalize(franchiseTitle).replace(/ /g, "-")}`,
        kind: "series-candidate",
        source: "tvdb",
        franchiseTitle,
        tvdbId: match.tvdbId,
        episodateId: null,
        tvmazeId: null,
        show: match.name,
        premiered: match.premiered || null,
        statusText: match.status || null,
        network: match.network || null,
        score: 3
      });
    }
  }

  return Array.from(all.values())
    .filter(item => item.score >= 2)
    .sort((a, b) => (b.score - a.score) || String(b.premiered || "").localeCompare(String(a.premiered || "")))
    .slice(0, 50)
    .map(({ score, ...item }) => item);
}

function addCandidate(map, show, franchiseTitle, seedId, trackedIds, baseScore, seedYear, seedNetwork) {
  const id = Number(show?.id);
  if (!id || id === seedId || trackedIds.has(id)) return;

  const premieredYear = Number(String(show.premiered || "").slice(0, 4)) || 0;
  // Don't dredge ancient catalog entries from before the seed franchise existed.
  if (seedYear && premieredYear && premieredYear < seedYear) return;

  let score = baseScore;
  if (seedNetwork && show.network === seedNetwork) score += 1;
  if (show.status === "Running" || show.status === "To Be Determined") score += 1;

  const key = `${franchiseTitle}|${id}`;
  const existing = map.get(key);
  if (existing) {
    existing.score += baseScore;
    return;
  }

  map.set(key, {
    id: `tvmaze-show:${id}:franchise:${normalize(franchiseTitle).replace(/ /g, "-")}`,
    kind: "series-candidate",
    source: "tvmaze",
    franchiseTitle,
    tvmazeId: id,
    show: show.name,
    premiered: show.premiered || null,
    statusText: show.status || null,
    network: show.network || null,
    score
  });
}

function dedupeEpisodes(items) {
  const seen = new Set();
  return items.filter(ep => {
    const key = [normalize(ep.show), ep.season ?? "", ep.number ?? "", normalize(ep.title || ""), ep.airdate || ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function json(data, status = 200) {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  }));
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

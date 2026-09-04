/**
 * DVR Wheel TV metadata Worker
 * Primary source: TVmaze public API
 * TVmaze-only evaluation build. No API key required.
 *
 * Routes:
 *   GET  /health
 *   GET  /api/search?q=Show%20Name
 *   POST /api/discover               { date: "YYYY-MM-DD", shows: [...] }
 *   POST /api/franchise-candidates   { franchises: [...], trackedIds: [...] }
 */

const APP = "DVR Wheel TV Bridge";
const VERSION = "0.2.3";
const TVMAZE = "https://api.tvmaze.com";
const UA = "DVR-Wheel/0.2.3";
const EPISODATE = "https://www.episodate.com/api";

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
          exactShowLock: true
        });
      }

      if (url.pathname === "/api/search" && request.method === "GET") {
        const q = (url.searchParams.get("q") || "").trim();
        if (!q) return json({ ok: false, error: "Missing q" }, 400);
        const results = await combinedSearch(q);
        return json({ ok: true, results });
      }

      if (url.pathname === "/api/discover" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        const date = String(body?.date || "");
        const shows = Array.isArray(body?.shows) ? body.shows.slice(0, 100) : [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: "Invalid date" }, 400);
        if (!shows.length) return json({ ok: true, date, episodes: [], resolvedShows: [] });

        const result = await discover(date, shows);
        return json({ ok: true, date, ...result });
      }

      if (url.pathname === "/api/franchise-candidates" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        const franchises = Array.isArray(body?.franchises) ? body.franchises.slice(0, 25) : [];
        const trackedIds = new Set((Array.isArray(body?.trackedIds) ? body.trackedIds : []).map(Number).filter(Boolean));
        const candidates = await discoverFranchiseCandidates(franchises, trackedIds);
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

async function combinedSearch(q) {
  const [maze, epi] = await Promise.all([
    tvmazeSearch(q).catch(() => []),
    episodateSearch(q).catch(() => [])
  ]);
  const wanted = normalize(q);
  const rows = [];
  for (const item of maze) rows.push({ ...item, source: "tvmaze", tvmazeId: Number(item.id), id: `tvmaze:${item.id}` });
  for (const item of epi) rows.push(item);

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
    const key = item.source === "tvmaze" ? `m:${item.tvmazeId}` : `e:${item.episodateId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

async function resolveExactTitle(title) {
  const norm = normalize(title);
  const [maze, epi] = await Promise.all([
    tvmazeSearch(title).catch(() => []),
    episodateSearch(title).catch(() => [])
  ]);
  const exactMaze = maze.find(x => normalize(x.name) === norm);
  const exactEpi = epi.find(x => normalize(x.name) === norm);
  return {
    tvmaze: exactMaze ? { id: Number(exactMaze.id), name: exactMaze.name } : null,
    episodate: exactEpi ? { id: Number(exactEpi.episodateId), name: exactEpi.name } : null
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

async function discover(date, shows) {
  const episodes = [];
  const resolvedShows = [];

  for (const raw of shows) {
    const title = String(raw?.title || "").trim();
    if (!title) continue;

    let mazeId = Number(raw?.tvmazeId) || null;
    let epiId = Number(raw?.episodateId) || null;
    let canonicalName = String(raw?.canonicalName || title);

    // Never use a fuzzy first-result fallback for an already tracked show.
    // If identity is missing, only bind a provider when the normalized title matches exactly.
    if (!mazeId || !epiId) {
      const exact = await resolveExactTitle(title);
      if (!mazeId && exact.tvmaze?.id) mazeId = exact.tvmaze.id;
      if (!epiId && exact.episodate?.id) epiId = exact.episodate.id;
      canonicalName = exact.tvmaze?.name || exact.episodate?.name || canonicalName;
    }

    let mazeEpisodes = [];
    if (mazeId) {
      try { mazeEpisodes = await tvmazeEpisodesByDate(mazeId, date); } catch { mazeEpisodes = []; }
      for (const ep of mazeEpisodes) episodes.push(normalizeMazeEpisode(ep, { id: mazeId, name: canonicalName }, title));
    }

    // EpisoDate is a no-key safety net. Use it when TVmaze has no episode for this date,
    // or when the show exists only in EpisoDate.
    if (epiId && mazeEpisodes.length === 0) {
      let epiEpisodes = [];
      try { epiEpisodes = await episodateEpisodesByDate(epiId, date); } catch { epiEpisodes = []; }
      for (const ep of epiEpisodes) episodes.push(normalizeEpisodateEpisode(ep, canonicalName, title, epiId));
    }

    resolvedShows.push({
      title,
      tvmazeId: mazeId,
      episodateId: epiId,
      canonicalName,
      source: mazeId ? (epiId ? "tvmaze+episodate" : "tvmaze") : (epiId ? "episodate" : "unresolved")
    });
  }

  return { episodes: dedupeEpisodes(episodes), resolvedShows };
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

async function discoverFranchiseCandidates(franchises, trackedIds) {
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

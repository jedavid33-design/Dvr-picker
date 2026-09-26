// Regression test for the 20/20 2026-09-25 fix:
//  - TVDB's "TBA" stub title must not clobber TMDB's real title during reconcile.
//  - The 20/20 season offset (-1) must correct S50 -> S49 for normal seasons
//    while leaving TVmaze's year-based season (2026) untouched.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "worker.js"), "utf8");
// Strip the `export default { ... };` block (lines ~21-109) so the pure
// functions load in node. Find its end by brace matching.
const start = src.indexOf("export default {");
if (start < 0) throw new Error("export default not found");
let depth = 0, end = -1;
for (let i = src.indexOf("{", start); i < src.length; i++) {
  const ch = src[i];
  if (ch === "{") depth++;
  else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
}
if (end < 0) throw new Error("export block end not found");
// Skip the trailing semicolon after the closing brace.
const body = src.slice(0, start) + src.slice(end + 1).replace(/^;/, "");
// Provide fetch-free stubs for anything the top-level scope might touch.
const sandbox = { fetch: async () => { throw new Error("no network in test"); } };
const factory = new Function("fetch", `${body}\nreturn { normalize, normalizeMazeEpisode, normalizeTmdbEpisode, normalizeTvdbEpisode, normalizeEpisodateEpisode, episodeSignature, reconcileProviderEpisodes, dedupeEpisodes, isPlaceholderEpisodeTitle, applyShowSeasonOffset };`);
const F = factory(sandbox.fetch);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`PASS  ${name}`); }
  else { failures++; console.log(`FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
}

// --- Scenario 1: the exact 20/20 2026-09-25 provider mix from the debug output
const maze = F.normalizeMazeEpisode(
  { id: 1, season: 2026, number: 22, name: "The Salem Strangler", airdate: "2026-09-25" },
  { id: 1401, name: "20/20" }, "20/20");
const tmdb = F.normalizeTmdbEpisode(
  { id: 999, season_number: 50, episode_number: 1, name: "The Salem Strangler", air_date: "2026-09-25" },
  "20/20", "20/20", 2035);
const tvdb = F.normalizeTvdbEpisode(
  { id: 11900628, seasonNumber: 50, number: 1, name: "TBA", aired: "2026-09-25" },
  "20/20", "20/20", 72289);

check("tvmaze year-season untouched by offset", maze.season === 2026, JSON.stringify(maze.season));
check("tmdb season corrected 50 -> 49", tmdb.season === 49, JSON.stringify(tmdb.season));
check("tmdb id embeds corrected season", tmdb.id.includes(":49:1:"), tmdb.id);
check("tvdb season corrected 50 -> 49", tvdb.season === 49, JSON.stringify(tvdb.season));
check("tvdb id embeds corrected season", tvdb.id.includes(":49:1:"), tvdb.id);

const reconciled = F.reconcileProviderEpisodes({ tvmaze: [maze], episodate: [], tmdb: [tmdb], tvdb: [tvdb] });
check("exactly one episode reconciled", reconciled.length === 1, JSON.stringify(reconciled.length));
const ep = reconciled[0] || {};
check("reconciled season is 49", ep.season === 49, JSON.stringify(ep));
check("reconciled number is 1", ep.number === 1, JSON.stringify(ep));
check("reconciled title is The Salem Strangler (not TBA)", ep.title === "The Salem Strangler", JSON.stringify(ep));
check("reconciled airdate preserved", ep.airdate === "2026-09-25", JSON.stringify(ep));

// --- Scenario 2: placeholder detection
for (const t of ["TBA", "tba", "T.B.A.", "TBD", "To Be Announced", "Untitled", "Episode 5", "Ep 12", "", null]) {
  check(`placeholder: ${JSON.stringify(t)}`, F.isPlaceholderEpisodeTitle(t) === true, "");
}
for (const t of ["The Salem Strangler", "Semifinals", "Episode Five", "TBA Special: Live"]) {
  check(`not placeholder: ${JSON.stringify(t)}`, F.isPlaceholderEpisodeTitle(t) === false, "");
}

// --- Scenario 3: winner keeps its own title when it is real (no regression)
const tvdbReal = F.normalizeTvdbEpisode(
  { id: 5, seasonNumber: 3, number: 2, name: "Real Title", aired: "2026-09-25" },
  "Some Show", "Some Show", 1);
const tmdbOther = F.normalizeTmdbEpisode(
  { id: 6, season_number: 3, episode_number: 2, name: "Other Title", air_date: "2026-09-25" },
  "Some Show", "Some Show", 2);
const r3 = F.reconcileProviderEpisodes({ tvmaze: [], episodate: [], tmdb: [tmdbOther], tvdb: [tvdbReal] });
check("higher-weight real title wins unchanged", r3.length === 1 && r3[0].title === "Real Title", JSON.stringify(r3));

// --- Scenario 4: single-provider stub stays as-is (nothing to coalesce from)
const r4 = F.reconcileProviderEpisodes({ tvmaze: [], episodate: [], tmdb: [], tvdb: [tvdb] });
check("single provider path unchanged", r4.length === 1 && r4[0].title === "TBA" && r4[0].season === 49, JSON.stringify(r4));

// --- Scenario 5: offset does not leak to other shows
const other = F.normalizeTmdbEpisode(
  { id: 7, season_number: 50, episode_number: 1, name: "X", air_date: "2026-09-25" },
  "Some Other Show", "Some Other Show", 3);
check("no offset for other shows", other.season === 50, JSON.stringify(other.season));

// --- Scenario 6: null/undefined seasons survive the offset helper
check("null season stays null", F.applyShowSeasonOffset(null, "20/20") === null, "");
check("undefined season stays undefined", F.applyShowSeasonOffset(undefined, "20/20") === undefined, "");

if (failures) { console.log(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log("\nAll tests passed.");

const defaultMovies = [
  "Test 1",
  "Test 2",
  "Test 3",
  "🎲 Second Spin"
];

const colors = ["#b8dfe0", "#d8c6ea", "#c6d5f2", "#f0cbd8", "#d7d2ed", "#b8d9cf", "#ead6bd", "#c4d0eb", "#e0c5dc", "#b6d4e5"];
const storageKey = "bedtimeMovieWheel.v2";
const lastSpinStorageKey = "dvrPicker.lastSpin.v1";
const trackedShowsStorageKey = "dvrPicker.trackedShows.v1";
const discoveriesStorageKey = "dvrPicker.discoveries.v1";
const workerUrlStorageKey = "dvrPicker.workerUrl.v1";
const lastTvCheckStorageKey = "dvrPicker.lastTvCheck.v1";
const lastTvEpisodeDateStorageKey = "dvrPicker.lastTvEpisodeDate.v1";
const lastFranchiseCheckStorageKey = "dvrPicker.lastFranchiseCheck.v1";
const trackedTvExpandedStorageKey = "dvrPicker.trackedTvExpanded.v1";
let movies = load();
let lastState = null;
let selectedIndex = null;
let rotation = -Math.PI / 2;
let spinning = false;

const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const winnerEl = document.getElementById("winner");
const spinBtn = document.getElementById("spinBtn");
const watchedBtn = document.getElementById("watchedBtn");
const undoBtn = document.getElementById("undoBtn");
const resetBtn = document.getElementById("resetBtn");
const movieList = document.getElementById("movieList");
const totalSlices = document.getElementById("totalSlices");
const newMovie = document.getElementById("newMovie");
const addBtn = document.getElementById("addBtn");
const dialog = document.getElementById("confirmDialog");
const checkTvBtn = document.getElementById("checkTvBtn");
const discoveryList = document.getElementById("discoveryList");
const tvDiscoveryStatus = document.getElementById("tvDiscoveryStatus");
const discoveryActions = document.getElementById("discoveryActions");
const addAllDiscoveriesBtn = document.getElementById("addAllDiscoveriesBtn");
const dismissAllDiscoveriesBtn = document.getElementById("dismissAllDiscoveriesBtn");
const recentlyDismissedDetails = document.getElementById("recentlyDismissedDetails");
const recentlyDismissedList = document.getElementById("recentlyDismissedList");
const recentlyDismissedCount = document.getElementById("recentlyDismissedCount");
const trackedShowList = document.getElementById("trackedShowList");
const trackedShowInput = document.getElementById("trackedShowInput");
const searchTrackedShowBtn = document.getElementById("searchTrackedShowBtn");
const trackedSearchResults = document.getElementById("trackedSearchResults");
const workerUrlInput = document.getElementById("workerUrlInput");
const saveWorkerBtn = document.getElementById("saveWorkerBtn");
const debugShowSelect = document.getElementById("debugShowSelect");
const debugDateInput = document.getElementById("debugDateInput");
const runTvDebugBtn = document.getElementById("runTvDebugBtn");
const copyTvDebugBtn = document.getElementById("copyTvDebugBtn");
const tvDebugOutput = document.getElementById("tvDebugOutput");
const workerStatus = document.getElementById("workerStatus");
const franchiseCandidateList = document.getElementById("franchiseCandidateList");
const trackedTvDetails = document.getElementById("trackedTvDetails");

let trackedShows = loadJsonArray(trackedShowsStorageKey);
let discoveries = loadJsonArray(discoveriesStorageKey);
let tvSearchBusy = false;
const tvRollingTraceStorageKey = "dvrPicker.tvRollingTrace.v1";
const isolatedMissStorageKey = "dvrPicker.isolatedMisses.v1";

function loadIsolatedMisses() {
  try { return JSON.parse(localStorage.getItem(isolatedMissStorageKey) || "{}") || {}; }
  catch { return {}; }
}
function saveIsolatedMisses(value) {
  try { localStorage.setItem(isolatedMissStorageKey, JSON.stringify(value)); } catch {}
}
function isolatedMissKey(showKey, date) { return `${showKey}|${date}`; }
function noteIsolatedVerification(showKey, date, foundEpisode) {
  const misses = loadIsolatedMisses();
  const key = isolatedMissKey(showKey, date);
  if (foundEpisode) {
    delete misses[key];
    saveIsolatedMisses(misses);
    return;
  }
  misses[key] = Math.min(2, Number(misses[key] || 0) + 1);
  saveIsolatedMisses(misses);
  // Negative isolated lookups are diagnostic only. They can be flaky and must
  // never delete a positively discovered pending episode.
  return;
}

function writeRollingTrace(lines) {
  try { localStorage.setItem(tvRollingTraceStorageKey, JSON.stringify(lines.slice(-80))); } catch {}
}

function rollingTraceSnapshot(label) {
  const pending = pendingEpisodeDiscoveries().map(item => ({
    id: item.id || null,
    fp: discoveryFingerprint(item),
    show: item.show || item.trackedTitle || null,
    season: item.season ?? null,
    number: item.number ?? null,
    airdate: item.airdate || null,
    status: item.status || "pending"
  }));
  return `${label}: ${JSON.stringify(pending)}`;
}



function initTrackedTvDisclosure() {
  if (!trackedTvDetails) return;
  const saved = localStorage.getItem(trackedTvExpandedStorageKey);
  if (saved === "false") trackedTvDetails.open = false;
  else if (saved === "true") trackedTvDetails.open = true;

  trackedTvDetails.addEventListener("toggle", () => {
    localStorage.setItem(trackedTvExpandedStorageKey, String(trackedTvDetails.open));
  });
}

function setWinner(text) {
  winnerEl.textContent = text;
  const length = Array.from(text).length;
  winnerEl.classList.toggle("long-title", length >= 22);
  winnerEl.classList.toggle("very-long-title", length >= 36);
}

function freshDefaults() {
  return defaultMovies.map(title => ({
    title,
    weight: 1,
    locked: title === "🎲 Second Spin"
  }));
}

function load() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return freshDefaults();
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length === 0) return freshDefaults();
    return parsed
      .filter(item => item && typeof item.title === "string" && item.title.trim())
      .map(item => ({
  title: item.title.trim(),
  weight: Math.max(1, Number(item.weight) || 1),
  locked: item.locked || item.title.trim() === "🎲 Second Spin",
  airdate: /^\d{4}-\d{2}-\d{2}$/.test(item.airdate || "") ? item.airdate : null,
  addedAt: /^\d{4}-\d{2}-\d{2}$/.test(item.addedAt || "") ? item.addedAt : null,
  autoWeightStartedAt: /^\d{4}-\d{2}-\d{2}$/.test(item.autoWeightStartedAt || "") ? item.autoWeightStartedAt : null
}))
  } catch {
    return freshDefaults();
  }
}
// M6: the three main savers used to throw on QuotaExceededError (or in
// locked-down contexts), aborting handlers mid-action with the in-memory
// state changed but nothing persisted. Surface a visible status instead.
function storageWriteFailed() {
  tvDiscoveryStatus.textContent = "Couldn't save — browser storage is full or unavailable. Free space and try again.";
}
function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(movies)); }
  catch { storageWriteFailed(); }
}
function insertAtRandomWheelPosition(item) {
  // Existing array order IS the frozen wheel order. Choose one of N+1 insertion
  // boundaries so adding an item never changes the relative order of survivors.
  const index = Math.floor(Math.random() * (movies.length + 1));
  movies.splice(index, 0, item);
  return index;
}
function compareEpisodeListTitles(a, b) {
  return String(a?.title || "").localeCompare(String(b?.title || ""), undefined, {
    sensitivity: "base",
    numeric: true
  });
}
function localDayNumber(value) {
  const d = value ? new Date(String(value) + (String(value).length === 10 ? "T12:00:00" : "")) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
function automaticGrowthForDays(days) {
  const age = Math.max(0, Math.floor(Number(days) || 0));
  const incrementGrowth = 1.20;
  // Start at weight 1. Each day adds an increment that is 20% larger than
  // the previous day's increment: +1.00, +1.20, +1.44, +1.728, ...
  if (age === 0) return 1;
  return 1 + (Math.pow(incrementGrowth, age) - 1) / (incrementGrowth - 1);
}
function effectiveWeight(movie) {
  const manual = Math.max(1, Number(movie?.weight) || 1);
  if (movie?.locked) return manual;
  const today = localDayNumber(todayString());
  const air = localDayNumber(movie?.airdate);
  if (air != null && today != null) return automaticGrowthForDays(today - air);
  const started = localDayNumber(movie?.addedAt || movie?.autoWeightStartedAt);
  if (started != null && today != null) return manual * automaticGrowthForDays(today - started);
  return manual;
}
function totalWeight() { return movies.reduce((sum, m) => sum + effectiveWeight(m), 0); }

function loadLastSpin() {
  try {
    const saved = localStorage.getItem(lastSpinStorageKey);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed.title !== "string") {
      localStorage.removeItem(lastSpinStorageKey);
      return null;
    }
    const exactIndex = Number.isInteger(parsed.index) && movies[parsed.index]?.title === parsed.title
      ? parsed.index
      : movies.findIndex(item => item.title === parsed.title);
    if (exactIndex < 0) {
      localStorage.removeItem(lastSpinStorageKey);
      return null;
    }
    return {
      index: exactIndex,
      title: parsed.title,
      rotation: Number.isFinite(parsed.rotation) ? parsed.rotation : -Math.PI / 2
    };
  } catch {
    localStorage.removeItem(lastSpinStorageKey);
    return null;
  }
}

function saveLastSpin() {
  if (selectedIndex == null || !movies[selectedIndex]) return;
  localStorage.setItem(lastSpinStorageKey, JSON.stringify({
    index: selectedIndex,
    title: movies[selectedIndex].title,
    rotation
  }));
}

function clearLastSpin() {
  localStorage.removeItem(lastSpinStorageKey);
}

function weightedPick() {
  const total = totalWeight();
  let r = Math.random() * total;
  for (let i = 0; i < movies.length; i++) {
    r -= effectiveWeight(movies[i]);
    if (r < 0) return i;
  }
  return movies.length - 1;
}

function segmentCenter(index) {
  const total = totalWeight();
  let start = 0;
  for (let i = 0; i < index; i++) start += effectiveWeight(movies[i]) / total * Math.PI * 2;
  const arc = effectiveWeight(movies[index]) / total * Math.PI * 2;
  return start + arc / 2;
}

function normalizedAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function trackedSeriesNameForLegacyTitle(title) {
  const value = String(title || "").trim();
  const matches = trackedShows
    .map(show => String(show?.canonicalName || show?.title || "").trim())
    .filter(Boolean)
    .sort((a,b) => b.length - a.length);
  for (const show of matches) {
    const re = new RegExp(`^${show.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s+(\\d+)$`, "i");
    const m = value.match(re);
    if (m) return { show, season: null, number: Number(m[1]), legacy: true };
  }
  return null;
}

function episodeDescriptor(title) {
  const value = String(title || "").trim();
  let m = value.match(/^(.*?)\s*(?:·|—|-)\s*S(\d+)\s*E(\d+)\b/i);
  if (m) return { show: m[1].trim(), season: Number(m[2]), number: Number(m[3]), legacy: false };
  m = value.match(/^(.*?)\s*(?:·|—|-)\s*S(\d+)E(\d+)\b/i);
  if (m) return { show: m[1].trim(), season: Number(m[2]), number: Number(m[3]), legacy: false };
  return trackedSeriesNameForLegacyTitle(value);
}

function resolveNextUnwatchedEpisodeIndex(index) {
  const selected = movies[index];
  const descriptor = episodeDescriptor(selected?.title);
  if (!descriptor || !Number.isFinite(descriptor.number)) return index;
  const wantedShow = normalizeTrackedName(descriptor.show);
  const candidates = [];
  movies.forEach((movie, i) => {
    const d = episodeDescriptor(movie.title);
    if (!d || normalizeTrackedName(d.show) !== wantedShow || !Number.isFinite(d.number)) return;
    if (descriptor.season != null && d.season != null && d.season !== descriptor.season) return;
    if (d.number <= descriptor.number) candidates.push({ index: i, number: d.number });
  });
  if (!candidates.length) return index;
  candidates.sort((a,b) => a.number - b.number || a.index - b.index);
  return candidates[0].index;
}

// One-time migration (2026-10-03, v0.2.64): Coven Academy shipped on the wheel
// with TV-broadcast numbering (10 combined "A / B" episodes) but Disney+ lists
// 21 individual segments, so the wheel's "S1 E2" matched nothing on screen.
// Expand old-format slices and discovery records to the 21-segment numbering
// (segment titles from TVmaze, matching what the worker now serves).
// Watched state is preserved: only slices still on the wheel (unwatched) are
// expanded — episodes already marked watched stay gone, and the expanded
// discovery records keep their reviewed status so future runs don't re-offer
// the segments. The next-unwatched redirect keeps working because it keys off
// the parsed S/E numbers, which the new titles carry correctly.
const COVEN_SEGMENT_MIGRATION_KEY = "dvrPicker.covenAcademySegments.v1";
const COVEN_ACADEMY_SEGMENTS = [
  [[1, "A Hex Education"], [2, "Blood, Sweat, and Fears"], [3, "Mother of All Secrets"]],
  [[4, "Dead Ends"], [5, "Power Trip"]],
  [[6, "Roses Are Red"], [7, "Pick Your Poison"]],
  [[8, "The Scrying Game"], [9, "Trial by Fire"]],
  [[10, "Time Warp"], [11, "The Night It Happened"]],
  [[12, "Between Worlds"], [13, "What She Saw"]],
  [[14, "Witchgiving"], [15, "Cold Turkey"]],
  [[16, "1998"], [17, "Thicker Than Water"]],
  [[18, "Winter Solstice"], [19, "The Covening"]],
  [[20, "Bloodlines"], [21, "After the Ashes"]]
];
function isLegacyCovenAcademyEntry(showName, season, number, title) {
  return normalizeTrackedName(showName) === "coven academy" &&
    Number(season) === 1 && Number.isInteger(Number(number)) &&
    Number(number) >= 1 && Number(number) <= 10 &&
    String(title || "").includes(" / ");
}
function migrateCovenAcademySegments() {
  let flag = null;
  try { flag = localStorage.getItem(COVEN_SEGMENT_MIGRATION_KEY); } catch { return; }
  if (flag) return;
  let changed = false;

  const expandedMovies = [];
  for (const m of movies) {
    const d = episodeDescriptor(m.title);
    if (d && !d.legacy && isLegacyCovenAcademyEntry(d.show, d.season, d.number, m.title)) {
      for (const [segNum, segTitle] of COVEN_ACADEMY_SEGMENTS[d.number - 1]) {
        expandedMovies.push({ ...m, title: `Coven Academy · S1 E${segNum} · ${segTitle}` });
      }
      changed = true;
    } else {
      expandedMovies.push(m);
    }
  }
  if (changed) movies = expandedMovies;

  const expandedDiscoveries = [];
  for (const item of discoveries) {
    if ((item.kind || "episode") === "episode" &&
        isLegacyCovenAcademyEntry(item.show || item.trackedTitle, item.season, item.number, item.title)) {
      const num = Number(item.number);
      for (const [segNum, segTitle] of COVEN_ACADEMY_SEGMENTS[num - 1]) {
        expandedDiscoveries.push({
          ...item,
          id: `${item.id || "coven-academy"}#seg${segNum}`,
          season: 1,
          number: segNum,
          title: segTitle
        });
      }
      changed = true;
    } else {
      expandedDiscoveries.push(item);
    }
  }
  if (changed) discoveries = expandedDiscoveries;

  if (changed) { save(); saveDiscoveries(); }
  try { localStorage.setItem(COVEN_SEGMENT_MIGRATION_KEY, "1"); } catch {}
}

// One-time cleanup (2026-10-03, v0.2.65): the v0.2.64 segment migration left
// duplicate Coven Academy slices on the wheel (each segment twice). Dedupe to
// one slice per segment number, and drop S1 E1 ("A Hex Education") so the
// wheel starts at Disney+ S1 E2 ("Blood, Sweat, and Fears") per Julie.
const COVEN_DEDUP_KEY = "dvrPicker.covenAcademyDedup.v1";
function dedupCovenAcademySegments() {
  let flag = null;
  try { flag = localStorage.getItem(COVEN_DEDUP_KEY); } catch { return; }
  if (flag) return;
  let changed = false;
  const seen = new Set();
  const deduped = [];
  for (const m of movies) {
    const d = episodeDescriptor(m.title);
    if (d && normalizeTrackedName(d.show) === "coven academy" && Number(d.season) === 1) {
      const num = Number(d.number);
      if (num === 1 || seen.has(num)) { changed = true; continue; }
      seen.add(num);
    }
    deduped.push(m);
  }
  if (changed) { movies = deduped; save(); }
  try { localStorage.setItem(COVEN_DEDUP_KEY, "1"); } catch {}
}

function finishSpin(index) {
  if (index == null || !movies[index]) return;
  index = resolveNextUnwatchedEpisodeIndex(index);
  selectedIndex = index;
  spinning = false;
  setWinner(movies[index].title);
  winnerEl.setAttribute?.("aria-live", "polite");
  spinBtn.disabled = false;
  watchedBtn.disabled = false;
  saveLastSpin();
  drawWheel();
}

function spin() {
  if (spinning || !movies.length) return;
  selectedIndex = weightedPick();
  const center = segmentCenter(selectedIndex);
  const pointerAngle = -Math.PI / 2;
  const targetRotation = pointerAngle - center + Math.PI * 2 * (5 + Math.floor(Math.random() * 3));
  const start = rotation;
  const change = targetRotation - start;
  const duration = 4300;
  const startTime = performance.now();
  spinning = true;
  spinBtn.disabled = true;
  watchedBtn.disabled = true;
  setWinner("Spinning...");

  function animate(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 4);
    rotation = start + change * eased;
    drawWheel();
    if (t < 1) requestAnimationFrame(animate);
    else {
      rotation = targetRotation % (Math.PI * 2);
      finishSpin(selectedIndex);
    }
  }
  requestAnimationFrame(animate);
}

function markWatched() {
  if (selectedIndex == null) return;

  lastState = JSON.stringify(movies);

  // Delete the watched item.
  // Keep the locked Second Spin entry.
  movies = movies.filter((m, i) => i !== selectedIndex || m.locked);

  selectedIndex = null;
  clearLastSpin();
  setWinner("Tap Spin");
  watchedBtn.disabled = true;

  save();
  render();
}
function undo() {
  if (!lastState) return;
  movies = JSON.parse(lastState);
  lastState = null;
  selectedIndex = null;
  clearLastSpin();
  setWinner("Undone");
  watchedBtn.disabled = true;
save();
render();
}

function drawWheel() {
  const size = canvas.width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * .46;
  ctx.clearRect(0, 0, size, size);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.translate(-cx, -cy);

  let start = 0;
  const total = totalWeight();
  movies.forEach((movie, i) => {
    const arc = effectiveWeight(movie) / total * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + arc);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = 2;
    ctx.stroke();

    if (arc > 0.035) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + arc / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#393346";
      ctx.font = '600 18px "Avenir Next", Avenir, -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      const label = movie.title.length > 24 ? movie.title.slice(0, 23) + "…" : movie.title;
      ctx.fillText(label, radius - 18, 7);
      ctx.restore();
    }
    start += arc;
  });
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  const sheen = ctx.createRadialGradient(
    size * .28, size * .22, size * .03,
    size * .52, size * .52, radius
  );
  sheen.addColorStop(0, "rgba(255,255,255,.34)");
  sheen.addColorStop(.34, "rgba(255,255,255,.09)");
  sheen.addColorStop(.72, "rgba(231,225,243,.04)");
  sheen.addColorStop(1, "rgba(74,65,97,.13)");
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,255,.72)";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, size * .13, 0, Math.PI * 2);
  const hub = ctx.createRadialGradient(
    cx - size * .035, cy - size * .045, size * .01,
    cx, cy, size * .13
  );
  hub.addColorStop(0, "rgba(255,255,255,.98)");
  hub.addColorStop(.55, "rgba(248,246,250,.94)");
  hub.addColorStop(1, "rgba(225,223,235,.94)");
  ctx.fillStyle = hub;
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = "#ddd9df";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, size * .055, 0, Math.PI * 2);
  ctx.strokeStyle = "#c9c4cb";
  ctx.lineWidth = 8;
  ctx.stroke();
}

function renderList() {
  movieList.innerHTML = "";
  const total = totalWeight();
  totalSlices.textContent = `${movies.length} items`;
  const sorted = movies
    .map((movie, wheelIndex) => ({ movie, wheelIndex }))
    .sort((a, b) => compareEpisodeListTitles(a.movie, b.movie));

  sorted.forEach(({ movie, wheelIndex }) => {
    const row = document.createElement("div");
    row.className = "movie-row";
    const shownWeight = effectiveWeight(movie);
    const pct = Math.round(shownWeight / total * 100);
    row.innerHTML = `<div class="movie-title">${escapeHtml(movie.title)} <span class="tiny">${pct}%</span></div><div class="weight">${shownWeight.toFixed(1)}</div>${movie.locked ? "" : `<button class="remove" aria-label="Remove ${escapeHtml(movie.title)}">Remove</button>`}`;
    const removeBtn = row.querySelector(".remove");
    if (!removeBtn) { movieList.appendChild(row); return; }
    removeBtn.onclick = () => {
      // M1: belt-and-braces — the locked entry is never removable, matching
      // the markWatched() guard. The button is hidden for locked rows above.
      if (movie.locked) return;
      lastState = JSON.stringify(movies);
      const removedSelectedItem = wheelIndex === selectedIndex;
      movies.splice(wheelIndex, 1);
      if (removedSelectedItem) {
        selectedIndex = null;
        setWinner("Tap Spin");
        watchedBtn.disabled = true;
        clearLastSpin();
      } else if (selectedIndex != null && wheelIndex < selectedIndex) {
        selectedIndex -= 1;
        saveLastSpin();
      }
      save();
      render();
    };
    movieList.appendChild(row);
  });
}
function escapeHtml(text) { return text.replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function render() { drawWheel(); renderList(); }

spinBtn.onclick = spin;
watchedBtn.onclick = markWatched;
undoBtn.onclick = undo;
resetBtn.onclick = () => dialog.showModal();
document.getElementById("cancelReset").onclick = () => dialog.close();
document.getElementById("confirmReset").onclick = () => {
  lastState = JSON.stringify(movies);
  movies = freshDefaults();
  selectedIndex = null;
  clearLastSpin();
  setWinner("Reset");
  watchedBtn.disabled = true;
  save();
  render();
  dialog.close();
};
addBtn.onclick = () => {
  const title = newMovie.value.trim();
  if (!title) return;
  lastState = JSON.stringify(movies);
  insertAtRandomWheelPosition({
    title,
    weight: 1,
    addedAt: todayString(),
    autoWeightStartedAt: todayString()
  });
  newMovie.value = "";
  save();
  render();
};
newMovie.addEventListener("keydown", e => { if (e.key === "Enter") addBtn.click(); });


// v0.2.64: expand any legacy Coven Academy TV-numbered slices/records to the
// 21 Disney+ segment numbering before the last-spin restore and first render.
// v0.2.65: dedupe any doubled segments and drop S1 E1 so the wheel starts at E2.
migrateCovenAcademySegments();
dedupCovenAcademySegments();

// v0.2.70: older load() code discarded airdate/autoWeightStartedAt, so the
// automatic age curve silently fell back to a static weight after reload.
// Repair existing TV slices from saved discovery history and give any remaining
// undated unlocked slice a local starting date so it ages correctly from now on.
function repairWheelWeightMetadata() {
  let changed = false;
  const addedByTitle = new Map();
  for (const ep of discoveries) {
    if ((ep.kind || "episode") !== "episode" || ep.status !== "added") continue;
    const title = episodeWheelTitle(ep);
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(ep.airdate || "")) continue;
    addedByTitle.set(title, ep.airdate);
  }

  for (const movie of movies) {
    if (movie.locked) continue;
    if (!movie.airdate) {
      const restoredAirdate = addedByTitle.get(movie.title);
      if (restoredAirdate) {
        movie.airdate = restoredAirdate;
        changed = true;
      }
    }
    if (!movie.airdate) {
      if (!movie.addedAt && movie.autoWeightStartedAt) {
        movie.addedAt = movie.autoWeightStartedAt;
        changed = true;
      }
      if (!movie.addedAt && !movie.autoWeightStartedAt) {
        // Exact historical add dates were not stored by older builds. Keep the
        // item's existing weight as its inherited priority and age forward from today.
        movie.addedAt = todayString();
        movie.autoWeightStartedAt = movie.addedAt;
        changed = true;
      } else if (movie.addedAt && !movie.autoWeightStartedAt) {
        movie.autoWeightStartedAt = movie.addedAt;
        changed = true;
      }
    }
  }

  if (changed) save();
}
repairWheelWeightMetadata();

const restoredSpin = loadLastSpin();
if (restoredSpin) {
  selectedIndex = restoredSpin.index;
  rotation = restoredSpin.rotation;
  setWinner(restoredSpin.title);
  watchedBtn.disabled = false;
} else {
  watchedBtn.disabled = true;
}

render();
document.fonts?.ready.then(drawWheel);


// ---- TV discovery integration -------------------------------------------------
// Deliberately isolated from the existing wheel localStorage key above.
function loadJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTrackedShows() {
  try { localStorage.setItem(trackedShowsStorageKey, JSON.stringify(trackedShows)); }
  catch { storageWriteFailed(); }
}

function saveDiscoveries() {
  try { localStorage.setItem(discoveriesStorageKey, JSON.stringify(discoveries)); }
  catch { storageWriteFailed(); }
}

function getWorkerUrl() {
  return (localStorage.getItem(workerUrlStorageKey) || "").trim().replace(/\/+$/, "");
}

function setWorkerStatus(message, state = "") {
  workerStatus.textContent = message;
  workerStatus.className = `tiny ${state}`.trim();
}

function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(value, count) {
  const date = typeof value === "string" ? parseLocalDate(value) : new Date(value);
  if (!date) return null;
  date.setDate(date.getDate() + count);
  return localDateString(date);
}

function daysBetween(fromValue, toValue) {
  const from = parseLocalDate(fromValue);
  const to = parseLocalDate(toValue);
  if (!from || !to) return 0;
  return Math.round((to - from) / 86400000);
}

function yesterdayString() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDateString(date);
}

function todayString() {
  return localDateString(new Date());
}

function formatAirdate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value || "";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(y, m - 1, d));
}

function episodeNumberLabel(ep) {
  if (ep.season == null && ep.number == null) return "";
  if (ep.season != null && ep.number != null) return `S${ep.season} E${ep.number}`;
  if (ep.season != null) return `S${ep.season}`;
  return `E${ep.number}`;
}

function episodeWheelTitle(ep) {
  const parts = [ep.show || ep.trackedTitle];
  const number = episodeNumberLabel(ep);
  if (number) parts.push(number);
  if (ep.title) parts.push(ep.title);
  return parts.filter(Boolean).join(" · ");
}

function pendingEpisodeDiscoveries() {
  const maxAirdate = yesterdayString();
  return discoveries.filter(item => {
    if ((item.kind || "episode") !== "episode") return false;
    if (item.status === "added" || item.status === "dismissed") return false;
    // "Check yesterday" is intentionally retrospective. Never surface a
    // pending episode dated today or in the future, even if a provider/backfill
    // returned it early. Keep reviewed records intact so dismissals still stick.
    if (/^\d{4}-\d{2}-\d{2}$/.test(item.airdate || "") && item.airdate > maxAirdate) return false;
    return true;
  });
}

function pendingFranchiseCandidates() {
  return discoveries.filter(item => item.kind === "series-candidate" && item.status !== "added" && item.status !== "dismissed");
}

function recentlyDismissedEpisodes() {
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  return discoveries
    .filter(item => {
      if ((item.kind || "episode") !== "episode" || item.status !== "dismissed") return false;
      const reviewed = Date.parse(item.reviewedAt || "");
      if (Number.isFinite(reviewed)) return reviewed >= cutoff;

      // Older DVR Wheel builds persisted the dismissal itself but did not always
      // attach reviewedAt. Keep those dismissals recoverable by falling back to
      // the episode airdate when it is recent enough. This does not change the
      // suppression state; it only makes the existing dismissed record visible
      // in Recently Dismissed so it can be restored.
      const aired = /^\d{4}-\d{2}-\d{2}$/.test(item.airdate || "")
        ? Date.parse(`${item.airdate}T12:00:00`)
        : NaN;
      return Number.isFinite(aired) && aired >= cutoff;
    })
    .sort((a, b) => Date.parse(b.reviewedAt || 0) - Date.parse(a.reviewedAt || 0));
}

// A5: resolve a discovery action target to the live object. Buttons pass the
// rendered record itself (immune to id rewrites between render and tap);
// callers holding only an id string still work via lookup.
function resolveDiscovery(ref) {
  if (!ref) return null;
  if (typeof ref === "object") {
    if (discoveries.includes(ref)) return ref;
    ref = ref.id;
  }
  return discoveries.find(item => item.id === ref) || null;
}

function restoreDismissedDiscovery(ref) {
  const ep = resolveDiscovery(ref);
  if (!ep || ep.status !== "dismissed" || (ep.kind || "episode") !== "episode") return;
  ep.status = "pending";
  delete ep.reviewedAt;
  saveDiscoveries();
  renderDiscoveries();
}

function renderRecentlyDismissed() {
  recentlyDismissedList.innerHTML = "";
  const dismissed = recentlyDismissedEpisodes();
  recentlyDismissedCount.textContent = dismissed.length ? `(${dismissed.length})` : "";
  recentlyDismissedDetails.hidden = dismissed.length === 0;

  dismissed.forEach(ep => {
    const row = document.createElement("div");
    row.className = "discovery-row";
    const main = document.createElement("div");
    main.className = "discovery-main";
    const show = document.createElement("div");
    show.className = "discovery-show";
    show.textContent = ep.show || ep.trackedTitle || "Unknown show";
    const meta = document.createElement("div");
    meta.className = "discovery-meta";
    meta.textContent = [episodeNumberLabel(ep), ep.title, formatAirdate(ep.airdate)].filter(Boolean).join(" · ");
    main.append(show, meta);
    const buttons = document.createElement("div");
    buttons.className = "discovery-buttons";
    const restore = document.createElement("button");
    restore.className = "quiet-btn";
    restore.textContent = "Restore";
    restore.onclick = () => restoreDismissedDiscovery(ep);
    buttons.append(restore);
    row.append(main, buttons);
    recentlyDismissedList.appendChild(row);
  });
}

function renderDiscoveries() {
  discoveryList.innerHTML = "";
  franchiseCandidateList.innerHTML = "";
  renderRecentlyDismissed();
  const pending = pendingEpisodeDiscoveries();
  const franchisePending = pendingFranchiseCandidates();
  discoveryActions.hidden = pending.length === 0;

  if (!getWorkerUrl()) {
    tvDiscoveryStatus.textContent = "Connect the TV search to check for new episodes automatically.";
  } else if (!trackedShows.length) {
    tvDiscoveryStatus.textContent = "Add a tracked show below, then I’ll check automatically.";
  } else if (!pending.length && !franchisePending.length) {
    const checkedThrough = localStorage.getItem(lastTvEpisodeDateStorageKey);
    tvDiscoveryStatus.textContent = checkedThrough
      ? `Caught up through ${formatAirdate(checkedThrough)}. Nothing waiting for review.`
      : "Ready to check yesterday.";
  } else {
    const bits = [];
    if (pending.length) bits.push(`${pending.length} new episode${pending.length === 1 ? "" : "s"}`);
    if (franchisePending.length) bits.push(`${franchisePending.length} possible spinoff${franchisePending.length === 1 ? "" : "s"}`);
    tvDiscoveryStatus.textContent = `${bits.join(" and ")} waiting for review.`;
  }

  pending.forEach(ep => {
    const row = document.createElement("div");
    row.className = "discovery-row";

    const main = document.createElement("div");
    main.className = "discovery-main";

    const show = document.createElement("div");
    show.className = "discovery-show";
    show.textContent = ep.show || ep.trackedTitle || "Unknown show";

    const meta = document.createElement("div");
    meta.className = "discovery-meta";
    const bits = [episodeNumberLabel(ep), ep.title, formatAirdate(ep.airdate)].filter(Boolean);
    meta.textContent = bits.join(" · ");

    main.append(show, meta);

    const buttons = document.createElement("div");
    buttons.className = "discovery-buttons";
    const add = document.createElement("button");
    add.textContent = "Add";
    add.onclick = () => addDiscoveryToWheel(ep);
    const dismiss = document.createElement("button");
    dismiss.className = "quiet-btn";
    dismiss.textContent = "Dismiss";
    dismiss.onclick = () => dismissDiscovery(ep);
    buttons.append(add, dismiss);

    row.append(main, buttons);
    discoveryList.appendChild(row);
  });

  franchisePending.forEach(candidate => {
    const row = document.createElement("div");
    row.className = "discovery-row franchise-candidate-row";
    const main = document.createElement("div");
    main.className = "discovery-main";
    const show = document.createElement("div");
    show.className = "discovery-show";
    show.textContent = candidate.show || "Possible spinoff";
    const meta = document.createElement("div");
    meta.className = "discovery-meta";
    const source = candidate.franchiseTitle ? `Possible ${candidate.franchiseTitle} franchise match` : "Possible franchise match";
    const detail = [source, candidate.network, candidate.premiered ? `started ${String(candidate.premiered).slice(0, 4)}` : ""].filter(Boolean);
    meta.textContent = detail.join(" · ");
    main.append(show, meta);
    const buttons = document.createElement("div");
    buttons.className = "discovery-buttons";
    const track = document.createElement("button");
    track.textContent = "Track";
    track.onclick = () => approveFranchiseCandidate(candidate);
    const ignore = document.createElement("button");
    ignore.className = "quiet-btn";
    ignore.textContent = "Ignore";
    ignore.onclick = () => dismissDiscovery(candidate);
    buttons.append(track, ignore);
    row.append(main, buttons);
    franchiseCandidateList.appendChild(row);
  });
}

function addDiscoveryToWheel(ref) {
  // A5: provider ids can be rewritten across runs (source reconciliation
  // flaps), so resolve the live discovery object first — object identity when
  // the caller passes the rendered record, id lookup as a fallback.
  const ep = resolveDiscovery(ref);
  if (!ep || ep.status === "added" || ep.kind === "series-candidate") return;

  // Freeze survivor order; only the newly added episode chooses a random wheel slot.
  lastState = JSON.stringify(movies);
  insertAtRandomWheelPosition({ title: episodeWheelTitle(ep), weight: 1, locked: false, airdate: ep.airdate || null });
  ep.status = "added";
  ep.reviewedAt = new Date().toISOString();
  save();
  saveDiscoveries();
  render();
  renderDiscoveries();
}

function dismissDiscovery(ref) {
  const ep = resolveDiscovery(ref);
  if (!ep) return;
  ep.status = "dismissed";
  ep.reviewedAt = new Date().toISOString();
  saveDiscoveries();
  renderDiscoveries();
}

function addAllDiscoveries() {
  const pending = pendingEpisodeDiscoveries();
  if (!pending.length) return;
  lastState = JSON.stringify(movies);
  for (const ep of pending) {
    insertAtRandomWheelPosition({ title: episodeWheelTitle(ep), weight: 1, locked: false, airdate: ep.airdate || null });
    ep.status = "added";
    ep.reviewedAt = new Date().toISOString();
  }
  save();
  saveDiscoveries();
  render();
  renderDiscoveries();
}

function dismissAllDiscoveries() {
  for (const ep of pendingEpisodeDiscoveries()) {
    ep.status = "dismissed";
    ep.reviewedAt = new Date().toISOString();
  }
  saveDiscoveries();
  renderDiscoveries();
}

function approveFranchiseCandidate(ref) {
  const candidate = resolveDiscovery(ref);
  if (!candidate || candidate.kind !== "series-candidate") return;
  if (!trackedShows.some(item =>
    (candidate.tvmazeId && Number(item.tvmazeId) === Number(candidate.tvmazeId)) ||
    (candidate.episodateId && Number(item.episodateId) === Number(candidate.episodateId)) ||
    (candidate.tmdbId && Number(item.tmdbId) === Number(candidate.tmdbId)) ||
    (candidate.tvdbId && Number(item.tvdbId) === Number(candidate.tvdbId)) ||
    normalizeTrackedName(item.title) === normalizeTrackedName(candidate.show)
  )) {
    trackedShows.push({
      title: candidate.show,
      canonicalName: candidate.show,
      tvmazeId: candidate.tvmazeId || null,
      episodateId: candidate.episodateId || null,
      tmdbId: candidate.tmdbId || null,
      tvdbId: candidate.tvdbId || null,
      network: candidate.network || null,
      kind: "show"
    });
    saveTrackedShows();
  }
  candidate.status = "added";
  candidate.reviewedAt = new Date().toISOString();
  saveDiscoveries();
  renderTrackedShows();
  renderDiscoveries();
}

function renderTrackedShows() {
  trackedShowList.innerHTML = "";
  if (!trackedShows.length) {
    const empty = document.createElement("p");
    empty.className = "tiny";
    empty.textContent = "No tracked shows yet.";
    trackedShowList.appendChild(empty);
    return;
  }

  const sortedTrackedShows = trackedShows
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.canonicalName || a.item.title || "").localeCompare(
      b.item.canonicalName || b.item.title || "", undefined, { sensitivity: "base" }
    ));

  sortedTrackedShows.forEach(({ item, index }) => {
    const row = document.createElement("div");
    row.className = "tracked-row";
    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "tracked-name";
    name.textContent = item.canonicalName || item.title;
    const detail = document.createElement("div");
    detail.className = "tracked-detail";
    const franchise = item.kind === "franchise" ? "Franchise watch" : "Show";
    detail.textContent = [franchise, item.network, item.tvmazeId ? `TVmaze #${item.tvmazeId}` : "", item.episodateId ? `EpisoDate #${item.episodateId}` : "", item.tmdbId ? `TMDB #${item.tmdbId}` : "", item.tvdbId ? `TVDB #${item.tvdbId}` : ""].filter(Boolean).join(" · ");
    info.append(name, detail);

    const controls = document.createElement("div");
    controls.className = "tracked-controls";
    const franchiseToggle = document.createElement("button");
    franchiseToggle.className = "quiet-btn";
    franchiseToggle.textContent = item.kind === "franchise" ? "Show only" : "Watch franchise";
    franchiseToggle.onclick = () => {
      item.kind = item.kind === "franchise" ? "show" : "franchise";
      saveTrackedShows();
      renderTrackedShows();
      if (item.kind === "franchise") checkFranchiseCandidates({ force: true });
    };
    const remove = document.createElement("button");
    remove.className = "quiet-btn";
    remove.textContent = "Remove";
    remove.onclick = () => {
      trackedShows.splice(index, 1);
      saveTrackedShows();
      renderTrackedShows();
      renderDiscoveries();
    };
    controls.append(franchiseToggle, remove);
    row.append(info, controls);
    trackedShowList.appendChild(row);
  });
}

const workerTokenStorageKey = "dvrPicker.workerToken.v1";
function getWorkerToken() {
  try { return (localStorage.getItem(workerTokenStorageKey) || "").trim(); }
  catch { return ""; }
}

async function workerFetch(path, options = {}) {
  const base = getWorkerUrl();
  if (!base) throw new Error("Add the Worker URL in TV Connection first.");
  // A3: a hung upstream must never wedge the UI on "Checking…" forever.
  // Abort the request after 30s and surface the timeout honestly; every
  // caller already resets tvSearchBusy in a finally block.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const headers = { ...(options.headers || {}) };
    const token = getWorkerToken();
    if (token) headers["x-dvr-token"] = token;
    const response = await fetch(`${base}${path}`, { ...options, headers, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("Worker request timed out after 30s.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function searchTrackedShow() {
  const query = trackedShowInput.value.trim();
  if (!query || tvSearchBusy) return;
  tvSearchBusy = true;
  searchTrackedShowBtn.disabled = true;
  searchTrackedShowBtn.textContent = "Finding…";
  trackedSearchResults.innerHTML = "";
  try {
    const payload = await workerFetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!payload.results?.length) {
      const empty = document.createElement("p");
      empty.className = "tiny";
      empty.textContent = "No matches found.";
      trackedSearchResults.appendChild(empty);
      return;
    }
    payload.results.forEach(result => {
      const row = document.createElement("div");
      row.className = "search-result-row";
      const info = document.createElement("div");
      const name = document.createElement("div");
      name.className = "search-result-name";
      name.textContent = result.name;
      const detail = document.createElement("div");
      detail.className = "search-result-detail";
      detail.textContent = [result.network, result.country, result.premiered ? `started ${result.premiered.slice(0, 4)}` : "", result.status, result.source === "episodate" ? "EpisoDate fallback" : result.source === "tmdb" ? "TMDB fallback" : result.source === "tvdb" ? "TheTVDB fallback" : "TVmaze"].filter(Boolean).join(" · ");
      info.append(name, detail);
      const buttons = document.createElement("div");
      buttons.className = "search-result-buttons";
      const track = document.createElement("button");
      track.textContent = "Track";
      track.onclick = () => addTrackedResult(result, "show");
      const franchise = document.createElement("button");
      franchise.className = "quiet-btn";
      franchise.textContent = "Track franchise";
      franchise.onclick = () => addTrackedResult(result, "franchise");
      buttons.append(track, franchise);
      row.append(info, buttons);
      trackedSearchResults.appendChild(row);
    });
  } catch (error) {
    const problem = document.createElement("p");
    problem.className = "tiny";
    problem.textContent = error.message;
    trackedSearchResults.appendChild(problem);
  } finally {
    tvSearchBusy = false;
    searchTrackedShowBtn.disabled = false;
    searchTrackedShowBtn.textContent = "Find";
  }
  refreshDebugShowOptions();
}

function addTrackedResult(result, kind) {
  const tvmazeId = Number(result.tvmazeId || (result.source === "tvmaze" ? String(result.id).replace(/^tvmaze:/, "") : 0)) || null;
  const episodateId = Number(result.episodateId || (result.source === "episodate" ? String(result.id).replace(/^episodate:/, "") : 0)) || null;
  const tmdbId = Number(result.tmdbId || (result.source === "tmdb" ? String(result.id).replace(/^tmdb:/, "") : 0)) || null;
  const tvdbId = Number(result.tvdbId || (result.source === "tvdb" ? String(result.id).replace(/^tvdb:/, "") : 0)) || null;
  const existing = trackedShows.find(item =>
    (tvmazeId && Number(item.tvmazeId) === tvmazeId) ||
    (episodateId && Number(item.episodateId) === episodateId) ||
    (tmdbId && Number(item.tmdbId) === tmdbId) ||
    (tvdbId && Number(item.tvdbId) === tvdbId) ||
    normalizeTrackedName(item.title) === normalizeTrackedName(result.name)
  );
  let trackedItem = existing || null;
  if (existing) {
    if (kind === "franchise") existing.kind = "franchise";
    if (tvmazeId) existing.tvmazeId = tvmazeId;
    if (episodateId) existing.episodateId = episodateId;
    if (tmdbId) existing.tmdbId = tmdbId;
    if (tvdbId) existing.tvdbId = tvdbId;
    existing.canonicalName = result.name || existing.canonicalName || existing.title;
  } else {
    trackedItem = {
      title: result.name,
      canonicalName: result.name,
      tvmazeId,
      episodateId,
      tmdbId,
      tvdbId,
      network: result.network || null,
      kind
    };
    trackedShows.push(trackedItem);
  }
  saveTrackedShows();
  trackedShowInput.value = "";
  trackedSearchResults.innerHTML = "";
  renderTrackedShows();
  renderDiscoveries();
  if (trackedItem && !trackedItem.backfilledAt) initialBackfillShow(trackedItem);
  if (kind === "franchise") checkFranchiseCandidates({ force: true });
}

function normalizeTrackedName(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function isGenericEpisodeTitle(value) {
  const title = normalizeTrackedName(value);
  return !title || /^episode(?: \d+)?$/.test(title) || /^ep(?:isode)? \d+$/.test(title);
}

function sameReviewedBroadcast(previous, incoming) {
  if (!previous || !incoming) return false;
  if (!previous.status || !["added", "dismissed"].includes(previous.status)) return false;

  // Same show + S/E is the same episode even when a provider reports a stale or
  // corrected airdate. Mirrors the worker's canonical episode identity.
  const prevEpisodeKeys = new Set(discoveryEpisodeIdentityKeys(previous));
  if (prevEpisodeKeys.size && discoveryEpisodeIdentityKeys(incoming).some(k => prevEpisodeKeys.has(k))) return true;

  const prevBroadcastKeys = new Set(discoveryBroadcastKeys(previous));
  if (!prevBroadcastKeys.size) return false;
  if (!discoveryBroadcastKeys(incoming).some(k => prevBroadcastKeys.has(k))) return false;

  // Exact S/E is obviously the same broadcast.
  if (String(previous.season ?? "") === String(incoming.season ?? "") &&
      String(previous.number ?? "") === String(incoming.number ?? "")) return true;

  // Late provider corrections frequently disagree on numbering while one side still
  // carries a generic "Episode N" title. Once that broadcast date has been reviewed,
  // suppress the stale alternate numbering instead of re-offering it days later.
  if (isGenericEpisodeTitle(previous.title) || isGenericEpisodeTitle(incoming.title)) return true;

  // Matching descriptive titles are also the same broadcast even if numbering differs.
  const a = normalizeTrackedName(previous.title);
  const b = normalizeTrackedName(incoming.title);
  return Boolean(a && b && a === b);
}

// A show's identity for dedupe: every normalized name variant we have for it.
// The provider canonical name can drift between queries (whichever provider
// answers first wins), while the user's tracked title is stable. Indexing both
// keeps reviewed records matching regardless of which name a run returns, and
// stays compatible with records stored before trackedTitle existed.
function discoveryShowKeys(item) {
  const keys = [];
  for (const name of [item?.trackedTitle, item?.show]) {
    const k = normalizeTrackedName(name);
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

function discoveryBroadcastKeys(item) {
  if (!item || (item.kind || "episode") !== "episode") return [];
  const airdate = item.airdate || "";
  if (!airdate) return [];
  return discoveryShowKeys(item).map(sk => `broadcast|${sk}|${airdate}`);
}

// S/E is the worker's canonical episode identity (episodeSignature). A provider
// reporting a stale or corrected airdate for the same S/E must not resurrect an
// already-reviewed episode as a new discovery.
function discoveryEpisodeIdentityKeys(item) {
  if (!item || (item.kind || "episode") !== "episode") return [];
  const s = Number(item.season);
  const n = Number(item.number);
  if (!Number.isFinite(s) || !Number.isFinite(n)) return [];
  return discoveryShowKeys(item).map(sk => `episode|${sk}|${s}|${n}`);
}

function discoveryFingerprint(item) {
  if (!item) return "";
  if (item.kind === "series-candidate") return `series|${normalizeTrackedName(item.show)}|${item.premiered || ""}`;
  const show = normalizeTrackedName(item.show || item.trackedTitle);
  const season = item.season ?? "";
  const number = item.number ?? "";
  const airdate = item.airdate || "";
  const title = normalizeTrackedName(item.title || "");
  // S/E + date is the strongest cross-provider identity. Title is the fallback when numbering is absent.
  return `episode|${show}|${season}|${number}|${airdate}|${season === "" && number === "" ? title : ""}`;
}

function hasFiniteEpisodeNumber(item) {
  return Number.isFinite(Number(item?.season)) && Number.isFinite(Number(item?.number));
}
// A pending slot is show + airdate + S/E when providers know it. Two genuinely
// different episodes airing the same night (double premieres/finales) must not
// collapse into one card the way stale provider numbering variants do.
function discoverySlotKeys(item) {
  if (!item || (item.kind || "episode") !== "episode") return [];
  const airdate = item.airdate || "";
  if (!airdate) return [];
  const sn = hasFiniteEpisodeNumber(item) ? `${Number(item.season)}|${Number(item.number)}` : "";
  return discoveryShowKeys(item).map(sk => `slot|${sk}|${airdate}|${sn}`);
}
function sameSlotEpisode(a, b) {
  return hasFiniteEpisodeNumber(a) && hasFiniteEpisodeNumber(b) &&
    Number(a.season) === Number(b.season) && Number(a.number) === Number(b.number);
}
// Two records describe the same episode when they share the worker's canonical
// S/E identity, or — when numbering is absent — the full fingerprint.
function sameEpisodeIdentity(a, b) {
  const ka = new Set(discoveryEpisodeIdentityKeys(a));
  if (ka.size && discoveryEpisodeIdentityKeys(b).some(k => ka.has(k))) return true;
  const fa = discoveryFingerprint(a);
  const fb = discoveryFingerprint(b);
  return Boolean(fa && fb && fa === fb);
}

function mergeDiscoveries(incoming) {
  // A TV broadcast slot is show + airdate + episode number when providers know
  // it. Provider IDs and episode numbers are metadata about that slot, not
  // separate discoveries — except on genuine multi-episode nights, where two
  // different S/E pairs are two different broadcasts sharing a date.
  const reviewedByBroadcast = new Map();
  const reviewedByEpisode = new Map();
  const pendingBySlot = new Map();
  const pendingByBroadcast = new Map();
  const other = [];

  const indexReviewed = (map, keys, item) => {
    for (const key of keys) {
      const prior = map.get(key);
      if (!prior || Date.parse(item.reviewedAt || 0) > Date.parse(prior.reviewedAt || 0)) map.set(key, item);
    }
  };

  for (const item of discoveries) {
    const bkeys = discoveryBroadcastKeys(item);
    const ekeys = discoveryEpisodeIdentityKeys(item);
    if (!bkeys.length && !ekeys.length) { other.push(item); continue; }
    if (["added", "dismissed"].includes(item.status)) {
      // Index under every name variant so provider canonical-name drift cannot
      // detach a reviewed record from later runs.
      indexReviewed(reviewedByBroadcast, bkeys, item);
      indexReviewed(reviewedByEpisode, ekeys, item);
    } else if (bkeys.length) {
      const skeys = discoverySlotKeys(item);
      const bTaken = bkeys.map(k => pendingByBroadcast.get(k)).find(Boolean);
      const seMismatch = Boolean(bTaken) && hasFiniteEpisodeNumber(item) && hasFiniteEpisodeNumber(bTaken) &&
        !sameSlotEpisode(item, bTaken);
      if (!skeys.some(k => pendingBySlot.has(k)) && (!bTaken || seMismatch)) {
        for (const k of skeys) pendingBySlot.set(k, item);
        for (const k of bkeys) if (!pendingByBroadcast.has(k)) pendingByBroadcast.set(k, item);
      }
      // else: duplicate slot, or a same-date item without distinguishing S/E —
      // keep the first indexed (legacy single-slot behavior).
    } else {
      other.push(item);
    }
  }

  for (const ep of incoming || []) {
    if (!ep?.id) continue;
    const bkeys = discoveryBroadcastKeys(ep);
    const ekeys = discoveryEpisodeIdentityKeys(ep);
    const skeys = discoverySlotKeys(ep);
    if (!bkeys.length && !ekeys.length) { other.push({ ...ep, status: ep.status || "pending" }); continue; }

    // Once the user added/dismissed an episode, never re-offer the same S/E under
    // a stale or corrected airdate.
    const reviewedEpisodeHit = ekeys.map(k => reviewedByEpisode.get(k)).find(Boolean);
    if (reviewedEpisodeHit) {
      // Heal a stale id on the reviewed record. Same S/E is the same episode,
      // so the worker's current id is authoritative: a record merged under the
      // old show+airdate slot rule can squat on a different episode's id, and
      // left alone the final id-dedupe would drop that episode's new card.
      if (reviewedEpisodeHit.id !== ep.id) reviewedEpisodeHit.id = ep.id;
      continue;
    }
    // Once the user reviewed this show/date, suppress only genuine variants of
    // that broadcast (stale numbering or title) — never a different episode
    // from a multi-episode night.
    const reviewedHits = [...new Set(bkeys.map(k => reviewedByBroadcast.get(k)).filter(Boolean))];
    const reviewedBroadcastHit = reviewedHits.find(r => sameReviewedBroadcast(r, ep));
    if (reviewedBroadcastHit) {
      // A5: heal a stale id on broadcast-key-matched reviewed records too, not
      // just S/E-matched ones. Guarded so a multi-episode night never heals one
      // episode's record to another episode's id: heal only when the records
      // identify as the same episode, or the reviewed record carries no finite
      // S/E that could conflict.
      if (reviewedBroadcastHit.id !== ep.id &&
          (sameEpisodeIdentity(reviewedBroadcastHit, ep) || !hasFiniteEpisodeNumber(reviewedBroadcastHit))) {
        reviewedBroadcastHit.id = ep.id;
      }
      continue;
    }

    let previous = skeys.map(k => pendingBySlot.get(k)).find(Boolean);
    if (!previous && bkeys.length) {
      const bPrev = bkeys.map(k => pendingByBroadcast.get(k)).find(Boolean);
      if (bPrev) {
        const seMismatch = hasFiniteEpisodeNumber(ep) && hasFiniteEpisodeNumber(bPrev) &&
          !sameSlotEpisode(ep, bPrev);
        const prevSupport = Number(bPrev._providerSupport || 0);
        const nextSupport = Number(ep._providerSupport || 0);
        // Two well-supported different episodes on one date is a genuine
        // multi-episode night: separate card. Weak support on either side means
        // a provider numbering correction: merge into the existing slot.
        previous = (!seMismatch || prevSupport < 2 || nextSupport < 2) ? bPrev : null;
      }
    }
    if (!previous) {
      const item = { ...ep, status: "pending" };
      // A pre-v0.2.60 record can squat on this episode's id (same id, different
      // episode). Re-key the squatter so the final id-dedupe cannot drop this
      // card; the squatter is repaired to its true id when its own episode
      // next arrives (merge branch / reviewed-episode heal above).
      if (item.id) {
        const rekeyed = new Set();
        const candidates = [...other, ...reviewedByBroadcast.values(), ...reviewedByEpisode.values(), ...pendingBySlot.values()];
        for (const rec of candidates) {
          if (!rec || rec === item || rec.id !== item.id || rekeyed.has(rec)) continue;
          rekeyed.add(rec);
          // A5: idempotent re-key — strip any existing #stale suffixes before
          // appending, so a squatted episode that never arrives cannot grow
          // the id into "#stale#stale…" across runs.
          if (!sameEpisodeIdentity(rec, item)) rec.id = String(rec.id).replace(/(#stale)+$/, "") + "#stale";
        }
      }
      for (const k of skeys) pendingBySlot.set(k, item);
      for (const k of bkeys) if (!pendingByBroadcast.has(k)) pendingByBroadcast.set(k, item);
      continue;
    }

    // New evidence may improve metadata, but it updates the existing broadcast slot.
    // Prefer stronger provider support; otherwise retain the stable identity/numbering.
    const prevSupport = Number(previous._providerSupport || 0);
    const nextSupport = Number(ep._providerSupport || 0);
    const metadataChanged =
      Number(previous.season) !== Number(ep.season) ||
      Number(previous.number) !== Number(ep.number) ||
      (ep.title && ep.title !== previous.title);
    const useIncoming = nextSupport > prevSupport ||
      (nextSupport === prevSupport && metadataChanged) ||
      (nextSupport === prevSupport && previous.season == null && ep.season != null) ||
      (nextSupport === prevSupport && previous.number == null && ep.number != null);
    // The card's id must identify the episode it now describes. A card merged
    // under the old show+airdate slot rule can squat on a different episode's id
    // (double-premiere corruption: E1's id carried on E2's season/episode); keeping
    // that stale id lets the final id-dedupe silently drop the genuinely different
    // episode. The incoming id is the worker's current identifier for this slot
    // episode, so adopt it and repair the squatting record.
    const merged = useIncoming
      ? { ...previous, ...ep, id: ep.id || previous.id, status: "pending" }
      : { ...ep, ...previous, id: ep.id || previous.id, status: "pending" };
    // Refresh every key still pointing at the previous object so older name
    // variants converge onto the merged record.
    for (const [k, v] of pendingBySlot) if (v === previous) pendingBySlot.set(k, merged);
    for (const [k, v] of pendingByBroadcast) if (v === previous) pendingByBroadcast.set(k, merged);
    for (const k of skeys) pendingBySlot.set(k, merged);
  }

  // One item can be indexed under several keys (name variants, broadcast + S/E).
  const seenIds = new Set();
  const seenFingerprints = new Set();
  discoveries = [
    ...other,
    ...reviewedByBroadcast.values(),
    ...reviewedByEpisode.values(),
    ...pendingBySlot.values()
  ].filter(item => {
    const id = item && item.id;
    if (id) {
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    }
    // M11: records without an id were kept unconditionally — the same object
    // indexed under multiple keys could survive twice. Dedupe them by
    // fingerprint instead.
    const fp = discoveryFingerprint(item);
    if (fp) {
      if (seenFingerprints.has(fp)) return false;
      seenFingerprints.add(fp);
    }
    return true;
  }).slice(-800);
  saveDiscoveries();
}
function migrateOldCheckState() {
  if (localStorage.getItem(lastTvEpisodeDateStorageKey)) return;
  const oldCheck = localStorage.getItem(lastTvCheckStorageKey);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(oldCheck || "")) return;
  const oldEpisodeDate = addDays(oldCheck, -1);
  if (oldEpisodeDate) localStorage.setItem(lastTvEpisodeDateStorageKey, oldEpisodeDate);
}

function rollingRecheckDates(days = 3) {
  const dates = [];
  const yesterday = yesterdayString();
  for (let i = Math.max(0, days - 1); i >= 0; i--) {
    const date = addDays(yesterday, -i);
    if (date) dates.push(date);
  }
  return dates;
}

function catchUpDates() {
  const yesterday = yesterdayString();
  const recent = new Set(rollingRecheckDates(3));
  const last = localStorage.getItem(lastTvEpisodeDateStorageKey);
  const dates = new Set();
  if (!last || !parseLocalDate(last)) { lastCatchUpTruncatedDays = 0; return []; }
  if (last < yesterday) {
    let start = addDays(last, 1);
    const gap = daysBetween(start, yesterday);
    // M9: never silently drop the older days — record how many were skipped
    // so the status line can report them.
    lastCatchUpTruncatedDays = gap > 29 ? gap - 29 : 0;
    if (gap > 29) start = addDays(yesterday, -29);
    for (let cursor = start; cursor && cursor <= yesterday; cursor = addDays(cursor, 1)) {
      if (!recent.has(cursor)) dates.add(cursor);
    }
  }
  return Array.from(dates).sort();
}

async function initialBackfillShow(show) {
  if (!show || show.backfilledAt || !getWorkerUrl()) return;
  try {
    tvDiscoveryStatus.textContent = `Looking back for ${show.title}…`;
    const payload = await workerFetch("/api/backfill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ show })
    });
    mergeDiscoveries(payload.episodes || []);
    const resolved = payload.resolvedShow || {};
    if (resolved.tvmazeId) show.tvmazeId = resolved.tvmazeId;
    if (resolved.episodateId) show.episodateId = resolved.episodateId;
    if (resolved.tmdbId) show.tmdbId = resolved.tmdbId;
    if (resolved.tvdbId) show.tvdbId = resolved.tvdbId;
    if (resolved.canonicalName) show.canonicalName = resolved.canonicalName;
    show.backfilledAt = todayString();
    show.backfillWindowDays = Number(payload.windowDays) || null;
    saveTrackedShows();
    renderTrackedShows();
    renderDiscoveries();
  } catch (error) {
    tvDiscoveryStatus.textContent = `Initial episode search paused: ${error.message}`;
  }
}


function refreshDebugShowOptions() {
  if (!debugShowSelect) return;
  const selectedTitle = debugShowSelect.selectedOptions?.[0]?.dataset?.title || "";
  let shows = Array.isArray(trackedShows) ? trackedShows : [];
  try {
    const stored = JSON.parse(localStorage.getItem(trackedShowsStorageKey) || "[]");
    if (Array.isArray(stored) && stored.length) shows = stored;
  } catch {}
  debugShowSelect.innerHTML = "";
  [...shows]
    .sort((a, b) => String(a.title || a.canonicalName || "").localeCompare(String(b.title || b.canonicalName || ""), undefined, { sensitivity: "base" }))
    .forEach((show) => {
      const option = document.createElement("option");
      option.value = String(show.tvmazeId || show.episodateId || show.tmdbId || show.tvdbId || show.title || show.canonicalName || "");
      option.dataset.title = show.title || show.canonicalName || "";
      option.textContent = show.title || show.canonicalName || "Untitled";
      debugShowSelect.appendChild(option);
    });
  if (selectedTitle) {
    const match = [...debugShowSelect.options].find(o => o.dataset.title === selectedTitle);
    if (match) debugShowSelect.value = match.value;
  }
}

function debugSuppressionReason(ep) {
  if (!ep) return "not returned by provider reconciliation";
  const exact = discoveries.find(item => discoveryFingerprint(item) === discoveryFingerprint(ep));
  if (exact) return `existing discovery: ${exact.status || "pending"}`;
  const reviewed = discoveries.filter(item => ["added", "dismissed"].includes(item.status));
  const sameBroadcast = reviewed.find(item => sameReviewedBroadcast(item, ep));
  if (sameBroadcast) {
    return `suppressed by reviewed broadcast guard: ${sameBroadcast.status} ${sameBroadcast.airdate || ""} ${episodeNumberLabel(sameBroadcast)}`.trim();
  }
  if (ep.airdate > yesterdayString()) return `blocked by yesterday-only guard (${ep.airdate} > ${yesterdayString()})`;
  return "would be eligible for New from TV";
}


function summarizeDiscovery(item) {
  if (!item) return null;
  return {
    id: item.id || null,
    fp: discoveryFingerprint(item),
    show: item.show || item.trackedTitle || null,
    season: item.season ?? null,
    number: item.number ?? null,
    airdate: item.airdate || null,
    status: item.status || "pending",
    title: item.title || null
  };
}

function traceIncomingAgainstState(ep) {
  const fp = discoveryFingerprint(ep);
  const sameId = discoveries.find(item => item.id === ep.id);
  const sameFp = discoveries.find(item => discoveryFingerprint(item) === fp);
  const sameBroadcast = discoveries.filter(item =>
    ["added", "dismissed"].includes(item.status) && sameReviewedBroadcast(item, ep)
  );
  return {
    incoming: summarizeDiscovery(ep),
    sameId: summarizeDiscovery(sameId),
    sameFingerprint: summarizeDiscovery(sameFp),
    reviewedBroadcastMatches: sameBroadcast.map(summarizeDiscovery),
    pendingBefore: pendingEpisodeDiscoveries().some(item => discoveryFingerprint(item) === fp)
  };
}

function simulateMergeForTrace(incoming) {
  const snapshot = JSON.stringify(discoveries);
  const persistedSnapshot = localStorage.getItem(discoveriesStorageKey);
  const before = incoming.map(traceIncomingAgainstState);
  mergeDiscoveries(incoming);
  const after = incoming.map(ep => {
    const fp = discoveryFingerprint(ep);
    const exact = discoveries.find(item => discoveryFingerprint(item) === fp);
    return {
      resulting: summarizeDiscovery(exact),
      pendingAfter: pendingEpisodeDiscoveries().some(item => discoveryFingerprint(item) === fp)
    };
  });
  discoveries = JSON.parse(snapshot);
  if (persistedSnapshot == null) localStorage.removeItem(discoveriesStorageKey);
  else localStorage.setItem(discoveriesStorageKey, persistedSnapshot);
  return { before, after };
}

async function runTvDebug() {
  if (!getWorkerUrl()) {
    tvDebugOutput.textContent = "Connect the Worker first.";
    return;
  }
  const title = debugShowSelect?.selectedOptions?.[0]?.dataset?.title;
  let show = trackedShows.find(item => (item.title || item.canonicalName) === title);
  if (!show) {
    try {
      const storedShows = JSON.parse(localStorage.getItem(trackedShowsStorageKey) || "[]");
      show = storedShows.find(item => (item.title || item.canonicalName) === title);
    } catch {}
  }
  const date = debugDateInput?.value;
  if (!show || !date) {
    tvDebugOutput.textContent = "Choose a tracked show and date.";
    return;
  }
  runTvDebugBtn.disabled = true;
  tvDebugOutput.textContent = "Checking providers…";
  try {
    const payload = await workerFetch("/api/debug-discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, show })
    });
    const normalPayload = await workerFetch("/api/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, maxAirdate: yesterdayString(), shows: [show] })
    });
    const lines = [`${show.title} · ${date}`];
    for (const source of ["tvmaze", "episodate", "tmdb", "tvdb"]) {
      const info = payload.providers?.[source] || {};
      if (!info.configured) {
        lines.push(`${source}: not configured`);
        continue;
      }
      if (!info.eligible?.length) {
        lines.push(`${source}: no matching episode${info.rawCount ? ` (${info.rawCount} raw result${info.rawCount === 1 ? "" : "s"} rejected by airdate)` : ""}`);
        continue;
      }
      for (const ep of info.eligible) {
        lines.push(`${source}: ${episodeNumberLabel(ep) || "no S/E"}${ep.title ? ` · ${ep.title}` : ""} · ${ep.airdate || "no date"}`);
      }
    }
    const normalEpisodes = normalPayload.episodes || [];
    lines.push(`Normal discover: ${normalEpisodes.length} episode${normalEpisodes.length === 1 ? "" : "s"} returned`);
    const mergeTrace = simulateMergeForTrace(normalEpisodes);
    for (const normalEp of normalEpisodes) {
      const existingById = discoveries.find(item => item.id === normalEp.id);
      const existingByFp = discoveries.find(item => discoveryFingerprint(item) === discoveryFingerprint(normalEp));
      const reviewedMatch = discoveries.find(item =>
        ["added", "dismissed"].includes(item.status) && sameReviewedBroadcast(item, normalEp)
      );
      const reason = existingById
        ? `existing id → ${existingById.status || "pending"}`
        : existingByFp
          ? `existing fingerprint → ${existingByFp.status || "pending"}`
          : reviewedMatch
            ? `reviewed-broadcast match → ${reviewedMatch.status}`
            : "new pending episode";
      lines.push(`Intake: ${episodeNumberLabel(normalEp) || "no S/E"} · ${normalEp.airdate || "no date"} · ${reason}`);
    }

    mergeTrace.before.forEach((row, index) => {
      lines.push(`Merge before ${index + 1}: ${JSON.stringify(row)}`);
      lines.push(`Merge after ${index + 1}: ${JSON.stringify(mergeTrace.after[index])}`);
    });
    try {
      const rollingTrace = JSON.parse(localStorage.getItem(tvRollingTraceStorageKey) || "[]");
      if (rollingTrace.length) {
        lines.push("Last normal rolling check:");
        for (const entry of rollingTrace) lines.push(entry);
      } else {
        lines.push("Last normal rolling check: no trace recorded yet");
      }
    } catch {
      lines.push("Last normal rolling check: unreadable trace");
    }

    if (!payload.reconciled?.length) {
      lines.push("Consensus: no episode");
      lines.push("Final: nothing to surface");
    } else {
      for (const ep of payload.reconciled) {
        const normalized = { ...ep, kind: "episode", show: show.canonicalName || show.title, trackedTitle: show.title };
        lines.push(`Consensus: ${episodeNumberLabel(normalized) || "no S/E"}${normalized.title ? ` · ${normalized.title}` : ""} · ${normalized.airdate || "no date"}`);
        lines.push(`Final: ${debugSuppressionReason(normalized)}`);
      }
    }
    // Surface timing already captured by normal catch-up/check runs. Reading this
    // does not start another discovery pass.
    const perf = JSON.parse(localStorage.getItem("dvrTvPerformanceDiagnostics") || "[]");
    if (perf.length) {
      lines.push("");
      lines.push("Performance diagnostics (latest 10 date checks):");
      for (const d of perf.slice(-10)) {
        lines.push(`${d.date}: total ${(d.totalMs / 1000).toFixed(1)}s · batches ${d.batches} [${(d.batchMs || []).join(", ")}ms] · retries ${d.retries} [${(d.retryMs || []).join(", ")}ms] · episodes ${d.episodes} · pruned ${(d.pruned || []).length}`);
      }
      const latest = perf[perf.length - 1];
      lines.push(`Latest pending after: ${JSON.stringify(latest.pendingAfter || [])}`);
      lines.push(`Latest pruned: ${JSON.stringify(latest.pruned || [])}`);
    }
    tvDebugOutput.textContent = lines.join("\n");
  } catch (error) {
    tvDebugOutput.textContent = `Debug failed: ${error.message}`;
  } finally {
    runTvDebugBtn.disabled = false;
  }
}


// v0.2.18: delegated diagnostic handler avoids init-order/cache-era listener failures.
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("#runTvDebugBtn");
  if (!button) return;
  event.preventDefault();
  runTvDebug();
});

// M9: catchUpDates() silently truncates gaps over 30 days. Track how many
// older days were skipped so the status line can say so honestly.
let lastCatchUpTruncatedDays = 0;

// A1/M10: shared end-of-run bookkeeping for the TV check entry points.
// dateResults entries look like Promise.allSettled results:
// { status: "fulfilled", value: payload } or { status: "rejected", reason }.
// The "checked through" marker advances only over the longest leading run of
// successfully checked dates (dates must be ascending); a failed date keeps
// the marker behind it so the next check retries it. lastTvCheck is stamped
// only when every date in the run completed.
function summarizeDateResults(dates, dateResults) {
  const failures = [];
  let prefixEnd = null;
  let prefixBroken = false;
  for (let i = 0; i < dates.length; i++) {
    const result = dateResults[i];
    const payload = result && result.status === "fulfilled" ? result.value : null;
    const ok = Boolean(payload && payload.ok === true);
    if (!ok) {
      prefixBroken = true;
      failures.push({
        date: dates[i],
        failedShows: Array.isArray(payload && payload.failedShows) ? payload.failedShows : []
      });
    } else if (!prefixBroken) {
      prefixEnd = dates[i];
    }
  }
  return { failures, prefixEnd };
}

function recordCompletedTvDates(dates, dateResults) {
  const { failures, prefixEnd } = summarizeDateResults(dates, dateResults);
  if (prefixEnd) localStorage.setItem(lastTvEpisodeDateStorageKey, prefixEnd);
  if (!failures.length) localStorage.setItem(lastTvCheckStorageKey, todayString());
  return failures;
}

// Honest end-of-run status: never let the status line claim "caught up" when
// a date did not actually complete, and say when old dates were skipped.
function reportTvCheckOutcome(failures) {
  if ((!failures || !failures.length) && !lastCatchUpTruncatedDays) return;
  const bits = (failures || []).map(f =>
    `${formatAirdate(f.date)}${f.failedShows.length ? ` (${f.failedShows.length} show check${f.failedShows.length === 1 ? "" : "s"} still failing)` : ""} — will retry`
  );
  if (lastCatchUpTruncatedDays > 0) {
    bits.push(`couldn't check ${lastCatchUpTruncatedDays} older day${lastCatchUpTruncatedDays === 1 ? "" : "s"} (gap over 30 days)`);
  }
  const pending = pendingEpisodeDiscoveries().length + pendingFranchiseCandidates().length;
  tvDiscoveryStatus.textContent = `Check incomplete: ${bits.join("; ")}.${pending ? ` ${pending} still waiting for review.` : ""}`;
}

async function discoverDate(date, { batchSize = 5 } = {}) {
  const diagStarted = performance.now();
  const diag = { date, batches: 0, retries: 0, batchMs: [], retryMs: [], pruned: [] };
  const maxAirdate = yesterdayString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || date > maxAirdate) {
    throw new Error(`TV checks cannot include ${date || "an invalid date"}; newest allowed date is ${maxAirdate}.`);
  }

  // A full tracked list can require hundreds of upstream provider requests. Keep each
  // Worker invocation deliberately small so later shows cannot disappear when one
  // request exhausts its provider/subrequest budget. Five shows per request leaves
  // ample room for identity resolution + TVmaze/EpisoDate/TMDB lookups.
  const DISCOVERY_BATCH_SIZE = Math.max(1, Number(batchSize) || 5);
  const allEpisodes = [];
  const allResolvedShows = [];
  // A1: a date is "checked" only when every batch succeeded AND no show
  // reported a provider lookup failure. Anything less leaves the date
  // unmarked so the next check retries it instead of silently dropping it.
  let checkFailed = false;
  const failedShowNames = new Set();
  const noteShowStatus = (payload) => {
    // Status is authoritative for the latest completed lookup of each show.
    // A transient provider failure may trigger an isolated retry; when that
    // retry succeeds, clear the earlier failure instead of leaving the date
    // permanently marked incomplete.
    for (const row of payload?.showStatus || []) {
      if (!row?.title) continue;
      const key = normalizeTrackedName(row.title);
      if (!key) continue;
      if (row.ok === false) failedShowNames.add(key);
      else if (row.ok === true) failedShowNames.delete(key);
    }
  };

  const runBatch = async (shows) => {
    const batchStarted = performance.now();
    const payload = await workerFetch("/api/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, maxAirdate, shows })
    });
    return { shows, payload, ms: Math.round(performance.now() - batchStarted) };
  };
  const batchInputs = [];
  for (let i = 0; i < trackedShows.length; i += DISCOVERY_BATCH_SIZE) {
    batchInputs.push(trackedShows.slice(i, i + DISCOVERY_BATCH_SIZE));
  }

  const settledBatches = await Promise.allSettled(batchInputs.map(runBatch));
  // One bounded retry with backoff for failed batches before giving up.
  const failedBatchIndexes = [];
  settledBatches.forEach((result, i) => { if (result.status !== "fulfilled") failedBatchIndexes.push(i); });
  if (failedBatchIndexes.length) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const retried = await Promise.allSettled(failedBatchIndexes.map(i => runBatch(batchInputs[i])));
    retried.forEach((result, j) => {
      diag.retries++;
      if (result.status === "fulfilled") settledBatches[failedBatchIndexes[j]] = result;
    });
  }
  const retryByKey = new Map();
  for (const result of settledBatches) {
    diag.batches++;
    if (result.status !== "fulfilled") { checkFailed = true; continue; }
    const { shows, payload, ms } = result.value;
    diag.batchMs.push(ms);
    noteShowStatus(payload);
    if (Array.isArray(payload.episodes)) allEpisodes.push(...payload.episodes.filter(ep => ep?.airdate === date));
    if (Array.isArray(payload.resolvedShows)) allResolvedShows.push(...payload.resolvedShows);

    const resolvedTitles = new Set((payload.resolvedShows || []).map(row => normalizeTrackedName(row.title)));
    const retryTitles = new Set((payload.retryShows || []).map(normalizeTrackedName));
    for (const show of shows) {
      const key = normalizeTrackedName(show.title || show.canonicalName);
      if (!resolvedTitles.has(key)) retryTitles.add(key);
    }
    for (const ep of payload.episodes || []) {
      if (ep?.airdate !== date) continue;
      const key = normalizeTrackedName(ep.show || ep.trackedTitle);
      const existing = discoveries.find(item =>
        item.status === "pending" &&
        item.airdate === date &&
        normalizeTrackedName(item.show || item.trackedTitle) === key
      );
      if (existing && (Number(existing.season) !== Number(ep.season) || Number(existing.number) !== Number(ep.number))) retryTitles.add(key);
    }
    for (const key of retryTitles) {
      const show = shows.find(row => normalizeTrackedName(row.title || row.canonicalName) === key);
      if (show) retryByKey.set(key, show);
    }
  }

  // Genuine conflicts are rare. Verify them concurrently too.
  const retryJobs = [...retryByKey.entries()].map(async ([key, show]) => {
    const retryStarted = performance.now();
    const payload = await workerFetch("/api/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, maxAirdate, shows: [show] })
    });
    return { key, payload, ms: Math.round(performance.now() - retryStarted) };
  });
  const settledRetries = await Promise.allSettled(retryJobs);
  for (const result of settledRetries) {
    diag.retries++;
    if (result.status !== "fulfilled") { checkFailed = true; continue; }
    const { key, payload, ms } = result.value;
    diag.retryMs.push(ms);
    noteShowStatus(payload);
    const retryEpisodes = (payload.episodes || []).filter(ep => ep?.airdate === date);
    if (retryEpisodes.length) {
      for (let j = allEpisodes.length - 1; j >= 0; j--) {
        const ep = allEpisodes[j];
        if (ep?.airdate === date && normalizeTrackedName(ep.show || ep.trackedTitle) === key) allEpisodes.splice(j, 1);
      }
      allEpisodes.push(...retryEpisodes);
    }
    if (Array.isArray(payload.resolvedShows)) allResolvedShows.push(...payload.resolvedShows);
  }

  // These high-frequency shows have repeatedly produced degraded batch results while
  // returning correct data when queried alone. Verify them independently after the
  // fast batch pass, then let that isolated result replace the batch result for the
  // same show/date. Run all verifications concurrently so the accuracy fix does not
  // bring back the old multi-minute latency.
  const isolatedVerifyNames = new Set([
    "big brother",
    "jeopardy",
    "wheel of fortune"
  ]);
  const verifyShows = trackedShows.filter(show =>
    isolatedVerifyNames.has(normalizeTrackedName(show.title || show.canonicalName))
  );
  if (verifyShows.length) {
    const verifyJobs = verifyShows.map(async show => {
      const key = normalizeTrackedName(show.title || show.canonicalName);
      const started = performance.now();
      const payload = await workerFetch("/api/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, maxAirdate, shows: [show] })
      });
      return { key, payload, ms: Math.round(performance.now() - started) };
    });
    const verified = await Promise.allSettled(verifyJobs);
    for (const result of verified) {
      // These three lookups are supplementary accuracy checks, not part of the
      // required date-completion pass. A failure here must not turn an otherwise
      // successful date into "Check incomplete" or re-add a show that the main
      // batch / mandatory retry already cleared.
      if (result.status !== "fulfilled") continue;
      const { key, payload, ms } = result.value;
      const isolatedEpisodes = (payload.episodes || []).filter(ep => ep?.airdate === date);
      noteIsolatedVerification(key, date, isolatedEpisodes.length > 0);

      // A2: one-source ghosts. An isolated query can surface a stale provider
      // record even when the batch discovery found no broadcast for this
      // show/date. Trust the isolated result unless it is a lone
      // single-provider sighting while 3+ providers were queried successfully
      // and the show is not a daily show whose databases update at different
      // speeds — mirroring the worker's own trust rule. Uses
      // discoveryFingerprint (the real one-object identity) and the
      // per-episode provider breakdown the worker now sends (_providerSupport,
      // _successfulProviders, _dailyShow).
      const normalHasBroadcast = allEpisodes.some(ep =>
        ep?.airdate === date &&
        normalizeTrackedName(ep.show || ep.trackedTitle) === key
      );
      const suspectGhost = isolatedEpisodes.length > 0 && !normalHasBroadcast &&
        isolatedEpisodes.every(ep =>
          Number(ep._providerSupport || 0) === 1 &&
          Number(ep._successfulProviders || 0) >= 3 &&
          !ep._dailyShow
        );
      if (suspectGhost) {
        const ghosts = new Set(isolatedEpisodes.map(ep => discoveryFingerprint(ep)));
        const before = discoveries.length;
        discoveries = discoveries.filter(item =>
          item.status !== "pending" ||
          item.kind === "series-candidate" ||
          !ghosts.has(discoveryFingerprint(item))
        );
        if (discoveries.length !== before) diag.pruned.push(`${key}: ghost-pruned ${before - discoveries.length}`);
        saveDiscoveries();
        continue;
      }

      if (!isolatedEpisodes.length) continue;

      // Replace only this show's batch result. A failed/empty isolated verification
      // does not delete a previously found broadcast.
      for (let j = allEpisodes.length - 1; j >= 0; j--) {
        const ep = allEpisodes[j];
        if (ep?.airdate === date && normalizeTrackedName(ep.show || ep.trackedTitle) === key) {
          allEpisodes.splice(j, 1);
        }
      }
      allEpisodes.push(...isolatedEpisodes);
      if (Array.isArray(payload.resolvedShows)) allResolvedShows.push(...payload.resolvedShows);
      diag.retryMs.push(ms);
    }
  }
  // A retry can duplicate an episode already returned by its batch. Collapse exact
  // show/S/E/date duplicates before merging into local discovery state.
  const uniqueEpisodes = [];
  const seenEpisodes = new Set();
  for (const ep of allEpisodes) {
    const key = [normalizeTrackedName(ep.show || ep.trackedTitle), ep.season ?? "", ep.number ?? "", ep.airdate || ""].join("|");
    if (seenEpisodes.has(key)) continue;
    seenEpisodes.add(key);
    uniqueEpisodes.push(ep);
  }

  // A1: gate the "checked" marker on fetch success. A failed batch (even after
  // the one bounded retry) or any show with a provider lookup failure leaves
  // this date unmarked, so the next check retries it instead of silently
  // dropping it while the UI claims to be caught up. M10: the marker itself
  // is written once by the caller (longest completed date prefix), never here.
  const checkOk = !checkFailed && failedShowNames.size === 0;
  const payload = {
    episodes: uniqueEpisodes,
    resolvedShows: allResolvedShows,
    ok: checkOk,
    date,
    failedShows: [...failedShowNames]
  };
  mergeDiscoveries(uniqueEpisodes);

  // Do not delete an established broadcast merely because a provider omitted it
  // on this refresh. Provider availability is intermittent. mergeDiscoveries() has
  // already canonicalized all returned evidence into one show+airdate slot.
  saveDiscoveries();
  renderDiscoveries();

  for (const resolved of allResolvedShows) {
    const item = trackedShows.find(x => x.title === resolved.title || x.canonicalName === resolved.title);
    if (item) {
      if (resolved.tvmazeId) item.tvmazeId = resolved.tvmazeId;
      if (resolved.episodateId) item.episodateId = resolved.episodateId;
      if (resolved.tmdbId) item.tmdbId = resolved.tmdbId;
      if (resolved.tvdbId) item.tvdbId = resolved.tvdbId;
      item.canonicalName = resolved.canonicalName || item.canonicalName || item.title;
    }
  }
  saveTrackedShows();
  diag.totalMs = Math.round(performance.now() - diagStarted);
  diag.episodes = uniqueEpisodes.length;
  diag.checkOk = checkOk;
  diag.failedShows = [...failedShowNames];
  diag.pendingAfter = discoveries.filter(x => x.status === "pending").map(x => ({ show: x.show || x.trackedTitle, season: x.season, number: x.number, airdate: x.airdate }));
  const history = JSON.parse(localStorage.getItem("dvrTvPerformanceDiagnostics") || "[]");
  history.push(diag);
  localStorage.setItem("dvrTvPerformanceDiagnostics", JSON.stringify(history.slice(-30)));
  return payload;
}

async function discoverYesterday({ automatic = false } = {}) {
  if (tvSearchBusy || !getWorkerUrl() || !trackedShows.length) return;
  tvSearchBusy = true;
  checkTvBtn.disabled = true;
  checkTvBtn.textContent = "Checking…";
  const dates = rollingRecheckDates(3);
  const trace = [`Started ${new Date().toISOString()} · dates ${dates.join(", ")}`, rollingTraceSnapshot("before loop")];
  const rollingEpisodes = [];
  writeRollingTrace(trace);
  tvDiscoveryStatus.textContent = `Checking recent TV…`;
  try {
    const dateResults = await Promise.allSettled(dates.map(date => discoverDate(date)));
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const result = dateResults[i];
      if (result.status === "fulfilled") {
        const payload = result.value;
        if (Array.isArray(payload?.episodes)) rollingEpisodes.push(...payload.episodes);
        trace.push(`${date} response: ${(payload.episodes || []).map(ep => `${ep.show || ep.trackedTitle} ${episodeNumberLabel(ep)} ${ep.airdate}`).join(" | ") || "no episodes"}`);
      } else {
        trace.push(`${date} ERROR: ${result.reason?.message || result.reason}`);
      }
      trace.push(rollingTraceSnapshot(`after ${date}`));
      writeRollingTrace(trace);
    }
    // M10: write the "checked through" marker once for the whole run — the
    // longest leading run of successfully checked dates — instead of racing
    // one write per concurrent date. A failed date keeps the marker behind it.
    const failures = recordCompletedTvDates(dates, dateResults);
    // Use every result observed in this completed rolling run, including earlier
    // broadcasts that were already reviewed and therefore are not pending cards.
    const earliestByEpisode = new Map();
    for (const ep of rollingEpisodes) {
      if (!Number.isFinite(Number(ep.season)) || !Number.isFinite(Number(ep.number))) continue;
      const key = [normalizeTrackedName(ep.show || ep.trackedTitle), Number(ep.season), Number(ep.number)].join("|");
      const prev = earliestByEpisode.get(key);
      if (!prev || ep.airdate < prev) earliestByEpisode.set(key, ep.airdate);
    }
    // Also reconcile same-show adjacent-date ghosts even when providers use incompatible
    // season/episode numbering (e.g. Dateline S34/E35 vs S2026/E24). Prefer an earlier
    // result only when it has stronger provider support than the later result.
    // A different finite S/E on the earlier date is a different broadcast
    // (daily/strip shows air distinct episodes on consecutive dates), never a
    // misdated variant — pruning those hides real episodes every morning.
    const earliestStrongByShow = new Map();
    for (const ep of rollingEpisodes) {
      const support = Number(ep._providerSupport || 0);
      if (support < 2) continue;
      const key = normalizeTrackedName(ep.show || ep.trackedTitle);
      const prev = earliestStrongByShow.get(key);
      if (!prev || ep.airdate < prev.airdate) earliestStrongByShow.set(key, {
        airdate: ep.airdate, support,
        season: Number(ep.season), number: Number(ep.number)
      });
    }

    const checkedDates = new Set(dates);
    discoveries = discoveries.filter(item => {
      if (item.status !== "pending" || item.kind === "series-candidate" || !checkedDates.has(item.airdate)) return true;
      if (!Number.isFinite(Number(item.season)) || !Number.isFinite(Number(item.number))) return true;
      const key = [normalizeTrackedName(item.show || item.trackedTitle), Number(item.season), Number(item.number)].join("|");
      const earliestDate = earliestByEpisode.get(key);
      if (earliestDate && item.airdate > earliestDate) return false;

      const showKey = normalizeTrackedName(item.show || item.trackedTitle);
      const earlierStrong = earliestStrongByShow.get(showKey);
      const runItem = rollingEpisodes.find(ep =>
        ep.airdate === item.airdate &&
        normalizeTrackedName(ep.show || ep.trackedTitle) === showKey &&
        Number(ep.season) === Number(item.season) &&
        Number(ep.number) === Number(item.number)
      );
      const sameBroadcastAsEarlier = !earlierStrong ||
        !Number.isFinite(Number(earlierStrong.season)) || !Number.isFinite(Number(earlierStrong.number)) ||
        (Number(earlierStrong.season) === Number(item.season) && Number(earlierStrong.number) === Number(item.number));
      if (sameBroadcastAsEarlier && earlierStrong && earlierStrong.airdate < item.airdate && Number(runItem?._providerSupport || 0) < earlierStrong.support) {
        return false;
      }
      return true;
    });
    saveDiscoveries();
    renderTrackedShows();
    renderDiscoveries();
    // A1: report honestly when any date did not complete, instead of letting
    // the status line claim "caught up".
    reportTvCheckOutcome(failures);
    trace.push(rollingTraceSnapshot("after final render"));
    writeRollingTrace(trace);
  } catch (error) {
    trace.push(`ERROR: ${error.message}`);
    trace.push(rollingTraceSnapshot("after error"));
    writeRollingTrace(trace);
    tvDiscoveryStatus.textContent = automatic ? `Automatic check skipped: ${error.message}` : error.message;
  } finally {
    tvSearchBusy = false;
    checkTvBtn.disabled = false;
    checkTvBtn.textContent = "Check yesterday";
  }
  // M7: the manual check is a full check too — franchise candidates included
  // (the 7-day throttle is respected inside checkFranchiseCandidates).
  await checkFranchiseCandidates();
}

async function unifiedOpenTvCheck({ automatic = false } = {}) {
  if (tvSearchBusy || !getWorkerUrl() || !trackedShows.length) return;
  const dates = Array.from(new Set([...catchUpDates(), ...rollingRecheckDates(3)])).sort();
  if (!dates.length) return;

  tvSearchBusy = true;
  checkTvBtn.disabled = true;
  checkTvBtn.textContent = "Checking…";
  const trace = [`Started unified open check ${new Date().toISOString()} · dates ${dates.join(", ")}`, rollingTraceSnapshot("before loop")];
  const rollingEpisodes = [];
  writeRollingTrace(trace);

  try {
    const dateResults = [];
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      tvDiscoveryStatus.textContent = dates.length === 1
        ? `Checking ${formatAirdate(date)}…`
        : `Checking TV ${i + 1} of ${dates.length} · ${formatAirdate(date)}…`;
      try {
        const payload = await discoverDate(date);
        dateResults.push({ status: "fulfilled", value: payload });
        if (Array.isArray(payload?.episodes)) rollingEpisodes.push(...payload.episodes);
        trace.push(`${date} response: ${(payload.episodes || []).map(ep => `${ep.show || ep.trackedTitle} ${episodeNumberLabel(ep)} ${ep.airdate}`).join(" | ") || "no episodes"}`);
      } catch (error) {
        dateResults.push({ status: "rejected", reason: error });
        trace.push(`${date} ERROR: ${error.message}`);
      }
      trace.push(rollingTraceSnapshot(`after ${date}`));
      writeRollingTrace(trace);
    }
    // M10: one marker write for the whole run — the longest leading run of
    // successfully checked dates. A failed date keeps the marker behind it.
    const failures = recordCompletedTvDates(dates, dateResults);

    // Missing from one refresh is NOT evidence that a known broadcast vanished.
    // Reconcile only positive conflicts observed inside this completed run.
    const checkedDates = new Set(dates);
    const bestByShowDate = new Map();
    for (const ep of rollingEpisodes) {
      const show = normalizeTrackedName(ep.show || ep.trackedTitle);
      const key = `${show}|${ep.airdate || ""}`;
      const prior = bestByShowDate.get(key);
      if (!prior || Number(ep._providerSupport || 0) > Number(prior._providerSupport || 0)) bestByShowDate.set(key, ep);
    }

    const runByShow = new Map();
    for (const ep of bestByShowDate.values()) {
      const show = normalizeTrackedName(ep.show || ep.trackedTitle);
      const list = runByShow.get(show) || [];
      list.push(ep);
      runByShow.set(show, list);
    }

    discoveries = discoveries.filter(item => {
      if (item.status !== "pending" || item.kind === "series-candidate" || !checkedDates.has(item.airdate)) return true;
      const show = normalizeTrackedName(item.show || item.trackedTitle);
      const sameShow = (runByShow.get(show) || []).slice().sort((a,b) => String(a.airdate).localeCompare(String(b.airdate)));
      if (sameShow.length < 2) return true;

      const currentRun = sameShow.find(ep => ep.airdate === item.airdate);
      // Only a same-broadcast (same S/E) variant on an earlier date is a genuine
      // conflict. Daily shows legitimately have different episodes on consecutive
      // dates; pruning those deletes real broadcasts (e.g. morning checks where
      // the newest episode still has the weakest provider support).
      const earlier = sameShow.filter(ep =>
        ep.airdate < item.airdate &&
        Number.isFinite(Number(ep.season)) && Number.isFinite(Number(ep.number)) &&
        Number.isFinite(Number(item.season)) && Number.isFinite(Number(item.number)) &&
        Number(ep.season) === Number(item.season) && Number(ep.number) === Number(item.number)
      ).sort((a,b) => Number(b._providerSupport || 0) - Number(a._providerSupport || 0))[0];
      if (currentRun && earlier &&
          Number(earlier._providerSupport || 0) > Number(currentRun._providerSupport || 0)) {
        trace.push(`final prune weaker later-date variant: ${item.show || item.trackedTitle} ${episodeNumberLabel(item)} ${item.airdate} → ${earlier.airdate}`);
        return false;
      }
      return true;
    });
    saveDiscoveries();
    renderTrackedShows();
    renderDiscoveries();
    // A1: report honestly when any date did not complete, instead of letting
    // the status line claim "caught up".
    reportTvCheckOutcome(failures);
    trace.push(rollingTraceSnapshot("after final render"));
    writeRollingTrace(trace);
  } catch (error) {
    tvDiscoveryStatus.textContent = automatic ? `Automatic TV check paused: ${error.message}` : error.message;
  } finally {
    tvSearchBusy = false;
    checkTvBtn.disabled = false;
    checkTvBtn.textContent = "Check yesterday";
  }
  await checkFranchiseCandidates();
}

async function checkFranchiseCandidates({ force = false } = {}) {
  const franchises = trackedShows.filter(item => item.kind === "franchise");
  if (!franchises.length || !getWorkerUrl()) return;
  const last = localStorage.getItem(lastFranchiseCheckStorageKey);
  if (!force && last && daysBetween(last, todayString()) < 7) return;
  try {
    const payload = await workerFetch("/api/franchise-candidates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        franchises,
        trackedIds: trackedShows.map(item => Number(item.tvmazeId)).filter(Boolean)
      })
    });
    mergeDiscoveries(payload.candidates || []);
    localStorage.setItem(lastFranchiseCheckStorageKey, todayString());
    renderDiscoveries();
  } catch {
    // Franchise discovery is helpful, but never allowed to break episode checks.
  }
}

async function saveAndTestWorker() {
  const value = workerUrlInput.value.trim().replace(/\/+$/, "");
  if (!value) {
    localStorage.removeItem(workerUrlStorageKey);
    setWorkerStatus("TV connection cleared.");
    renderDiscoveries();
    return;
  }
  localStorage.setItem(workerUrlStorageKey, value);
  setWorkerStatus("Testing…");
  try {
    const health = await workerFetch("/health");
    setWorkerStatus(`${health.app || "Worker"} ${health.version || ""} connected.`, "ok");
    renderDiscoveries();
  } catch (error) {
    setWorkerStatus(error.message, "error");
  }
}

function initTvDiscovery() {
  migrateOldCheckState();
  workerUrlInput.value = getWorkerUrl();
  renderTrackedShows();
  renderDiscoveries();

  checkTvBtn.onclick = () => discoverYesterday();
  addAllDiscoveriesBtn.onclick = addAllDiscoveries;
  dismissAllDiscoveriesBtn.onclick = dismissAllDiscoveries;
  searchTrackedShowBtn.onclick = searchTrackedShow;
  trackedShowInput.addEventListener("keydown", event => {
    if (event.key === "Enter") searchTrackedShow();
  });
  saveWorkerBtn.onclick = saveAndTestWorker;
  if (copyTvDebugBtn) copyTvDebugBtn.onclick = async () => {
    const text = tvDebugOutput?.textContent || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const old = copyTvDebugBtn.textContent;
      copyTvDebugBtn.textContent = "Copied!";
      setTimeout(() => { copyTvDebugBtn.textContent = old; }, 1200);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(tvDebugOutput);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      copyTvDebugBtn.textContent = "Select + Copy";
    }
  };
  if (debugDateInput && !debugDateInput.value) debugDateInput.value = yesterdayString();
  refreshDebugShowOptions();

  // One automatic TV action per day, not per open/reload (M12): skip when a
  // check already completed today and there is no catch-up gap, so repeated
  // opens don't multiply provider load. Build one date set containing
  // any true catch-up gap plus the latest three completed air dates, then process each
  // date exactly once. This replaces the old catch-up-then-check-yesterday double pass.
  if (getWorkerUrl() && trackedShows.length) {
    const checkedToday = localStorage.getItem(lastTvCheckStorageKey) === todayString();
    if (!checkedToday || catchUpDates().length) {
      unifiedOpenTvCheck({ automatic: true });
    }
  }
}

initTrackedTvDisclosure();
initTvDiscovery();

// v0.2.16: refresh diagnostics after localStorage-backed tracked state has initialized.
queueMicrotask(() => refreshDebugShowOptions());
window.addEventListener("pageshow", () => refreshDebugShowOptions());


// v0.2.36 diagnostic: in-app pull-to-refresh for installed/mobile web app.
// This deliberately performs a real page reload only. It does NOT start another
// TV discovery pass, so a refresh cannot accidentally add another five-minute check.
(() => {
  const threshold = 78;
  let startY = null;
  let pulling = false;
  let armed = false;
  const indicator = document.createElement("div");
  indicator.className = "pull-refresh-indicator";
  indicator.textContent = "Pull to refresh";
  document.body.appendChild(indicator);

  const reset = () => {
    startY = null; pulling = false; armed = false;
    indicator.classList.remove("visible", "armed");
    indicator.style.transform = "";
    indicator.textContent = "Pull to refresh";
  };

  document.addEventListener("touchstart", event => {
    if (window.scrollY > 0 || event.touches.length !== 1) return;
    startY = event.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener("touchmove", event => {
    if (!pulling || startY == null || window.scrollY > 0) return;
    const dy = Math.max(0, event.touches[0].clientY - startY);
    if (dy < 8) return;
    indicator.classList.add("visible");
    indicator.style.transform = `translate(-50%, ${Math.min(54, dy * .45)}px)`;
    armed = dy >= threshold;
    indicator.classList.toggle("armed", armed);
    indicator.textContent = armed ? "Release to refresh" : "Pull to refresh";
  }, { passive: true });

  document.addEventListener("touchend", () => {
    if (!pulling) return;
    if (armed) {
      indicator.textContent = "Refreshing…";
      indicator.classList.add("visible");
      // Reload the current document. Versioned assets in index.html then fetch the
      // current build rather than intentionally reusing an old app.js URL.
      window.location.reload();
      return;
    }
    reset();
  }, { passive: true });

  document.addEventListener("touchcancel", reset, { passive: true });
})();

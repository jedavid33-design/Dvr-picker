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
const weightModeStorageKey = "dvrPicker.weightMode.v1";
const autoWeightStartedStorageKey = "dvrPicker.autoWeightStarted.v1";
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
const increaseAllBtn = document.getElementById("increaseAllBtn");
const manualWeightModeBtn = document.getElementById("manualWeightModeBtn");
const autoWeightModeBtn = document.getElementById("autoWeightModeBtn");
const weightModeHint = document.getElementById("weightModeHint");
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
const tvDebugOutput = document.getElementById("tvDebugOutput");
const workerStatus = document.getElementById("workerStatus");
const franchiseCandidateList = document.getElementById("franchiseCandidateList");
const trackedTvDetails = document.getElementById("trackedTvDetails");

let trackedShows = loadJsonArray(trackedShowsStorageKey);
let discoveries = loadJsonArray(discoveriesStorageKey);
let tvSearchBusy = false;
let weightMode = localStorage.getItem(weightModeStorageKey) === "auto" ? "auto" : "manual";
const tvRollingTraceStorageKey = "dvrPicker.tvRollingTrace.v1";

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
  locked: item.locked || item.title.trim() === "🎲 Second Spin"
}))
  } catch {
    return freshDefaults();
  }
}
function save() { localStorage.setItem(storageKey, JSON.stringify(movies)); }
function localDayNumber(value) {
  const d = value ? new Date(String(value) + (String(value).length === 10 ? "T12:00:00" : "")) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
function automaticGrowthForDays(days) {
  const age = Math.max(0, Number(days) || 0);
  return age <= 3 ? 1 : Math.pow(1.2, age - 3);
}
function effectiveWeight(movie) {
  const manual = Math.max(1, Number(movie?.weight) || 1);
  if (movie?.locked || weightMode !== "auto") return manual;
  const today = localDayNumber(new Date().toISOString().slice(0,10));
  const air = localDayNumber(movie?.airdate);
  if (air != null && today != null) return automaticGrowthForDays(today - air);
  const started = localDayNumber(movie?.autoWeightStartedAt || localStorage.getItem(autoWeightStartedStorageKey));
  if (started != null && today != null) return manual * automaticGrowthForDays(today - started);
  return manual;
}
function totalWeight() { return movies.reduce((sum, m) => sum + effectiveWeight(m), 0); }
function setWeightMode(mode) {
  weightMode = mode === "auto" ? "auto" : "manual";
  if (weightMode === "auto" && !localStorage.getItem(autoWeightStartedStorageKey)) {
    localStorage.setItem(autoWeightStartedStorageKey, new Date().toISOString().slice(0,10));
  }
  localStorage.setItem(weightModeStorageKey, weightMode);
  updateWeightModeUi();
  render();
}
function updateWeightModeUi() {
  const automatic = weightMode === "auto";
  manualWeightModeBtn?.classList.toggle("active", !automatic);
  autoWeightModeBtn?.classList.toggle("active", automatic);
  if (increaseAllBtn) {
    increaseAllBtn.disabled = automatic;
    increaseAllBtn.hidden = automatic;
  }
  if (weightModeHint) weightModeHint.textContent = automatic
    ? "3-day grace, then ×1.2/day. Dated episodes use airdate; undated items grow from their stored starting value."
    : "Manual +1/day weighting.";
}

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

function updateWeights() {
  movies = movies.map((m, i) => ({
    ...m,
    weight: m.locked
      ? 1
      : i === selectedIndex
        ? 1
        : m.weight + 1
  }));
}

function markWatched() {
  if (selectedIndex == null) return;

  lastState = JSON.stringify(movies);

  // Delete the watched item.
  // Keep the locked Second Spin entry.
  movies = movies.filter((m, i) => i !== selectedIndex || m.locked);

  shuffleItems();

  selectedIndex = null;
  clearLastSpin();
  setWinner("Tap Spin");
  watchedBtn.disabled = true;

  save();
  render();
}
function increaseAllValues() {
  if (weightMode === "auto") return;

  lastState = JSON.stringify(movies);
  const pendingTitle = selectedIndex == null ? null : movies[selectedIndex]?.title;

  movies = movies.map(m => ({
  ...m,
  weight: m.locked ? 1 : m.weight + 1
}));

shuffleItems();

if (pendingTitle) {
  selectedIndex = movies.findIndex(item => item.title === pendingTitle);
  saveLastSpin();
}

save();
  render();
}
function shuffleItems() {
  for (let i = movies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [movies[i], movies[j]] = [movies[j], movies[i]];
  }
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
  movies.forEach((movie, index) => {
    const row = document.createElement("div");
    row.className = "movie-row";
    const shownWeight = effectiveWeight(movie);
    const pct = Math.round(shownWeight / total * 100);
    row.innerHTML = `<div class="movie-title">${escapeHtml(movie.title)} <span class="tiny">${pct}%</span></div><div class="weight">${weightMode === "auto" ? shownWeight.toFixed(shownWeight < 10 ? 1 : 0) : movie.weight}</div><button class="remove" aria-label="Remove ${escapeHtml(movie.title)}">Remove</button>`;
    row.querySelector(".remove").onclick = () => {
      lastState = JSON.stringify(movies);
      const removedSelectedItem = index === selectedIndex;
      movies.splice(index, 1);
      if (removedSelectedItem) {
        selectedIndex = null;
        setWinner("Tap Spin");
        watchedBtn.disabled = true;
        clearLastSpin();
      } else if (selectedIndex != null && index < selectedIndex) {
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
  movies.push({ title, weight: 1 });
  newMovie.value = "";
  save();
  render();
};
newMovie.addEventListener("keydown", e => { if (e.key === "Enter") addBtn.click(); });


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
increaseAllBtn.onclick = increaseAllValues;
manualWeightModeBtn?.addEventListener("click", () => setWeightMode("manual"));
autoWeightModeBtn?.addEventListener("click", () => setWeightMode("auto"));
updateWeightModeUi();
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
  localStorage.setItem(trackedShowsStorageKey, JSON.stringify(trackedShows));
}

function saveDiscoveries() {
  localStorage.setItem(discoveriesStorageKey, JSON.stringify(discoveries));
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

function restoreDismissedDiscovery(id) {
  const ep = discoveries.find(item => item.id === id);
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
    restore.onclick = () => restoreDismissedDiscovery(ep.id);
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
    add.onclick = () => addDiscoveryToWheel(ep.id);
    const dismiss = document.createElement("button");
    dismiss.className = "quiet-btn";
    dismiss.textContent = "Dismiss";
    dismiss.onclick = () => dismissDiscovery(ep.id);
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
    track.onclick = () => approveFranchiseCandidate(candidate.id);
    const ignore = document.createElement("button");
    ignore.className = "quiet-btn";
    ignore.textContent = "Ignore";
    ignore.onclick = () => dismissDiscovery(candidate.id);
    buttons.append(track, ignore);
    row.append(main, buttons);
    franchiseCandidateList.appendChild(row);
  });
}

function addDiscoveryToWheel(id) {
  const ep = discoveries.find(item => item.id === id);
  if (!ep || ep.status === "added" || ep.kind === "series-candidate") return;

  // Preservation rule: append only. Do not shuffle, reset, reweight, or migrate.
  lastState = JSON.stringify(movies);
  movies.push({ title: episodeWheelTitle(ep), weight: 1, locked: false, airdate: ep.airdate || null });
  ep.status = "added";
  ep.reviewedAt = new Date().toISOString();
  save();
  saveDiscoveries();
  render();
  renderDiscoveries();
}

function dismissDiscovery(id) {
  const ep = discoveries.find(item => item.id === id);
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
    movies.push({ title: episodeWheelTitle(ep), weight: 1, locked: false, airdate: ep.airdate || null });
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

function approveFranchiseCandidate(id) {
  const candidate = discoveries.find(item => item.id === id && item.kind === "series-candidate");
  if (!candidate) return;
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

async function workerFetch(path, options = {}) {
  const base = getWorkerUrl();
  if (!base) throw new Error("Add the Worker URL in TV Connection first.");
  const response = await fetch(`${base}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
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

function reviewedBroadcastKey(item) {
  if (!item || (item.kind && item.kind !== "episode")) return "";
  const show = normalizeTrackedName(item.show || item.trackedTitle);
  const airdate = /^\d{4}-\d{2}-\d{2}$/.test(item.airdate || "") ? item.airdate : "";
  if (!show || !airdate) return "";
  return `broadcast|${show}|${airdate}`;
}

function isGenericEpisodeTitle(value) {
  const title = normalizeTrackedName(value);
  return !title || /^episode(?: \d+)?$/.test(title) || /^ep(?:isode)? \d+$/.test(title);
}

function sameReviewedBroadcast(previous, incoming) {
  if (!previous || !incoming) return false;
  if (!previous.status || !["added", "dismissed"].includes(previous.status)) return false;
  if (reviewedBroadcastKey(previous) !== reviewedBroadcastKey(incoming)) return false;

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

function mergeDiscoveries(incoming) {
  // Canonicalize exact episode identities first. Provider reconciliation may choose
  // a different source ID on a later check, but show + S/E + airdate is still the
  // same broadcast. Keep one record and preserve its review state.
  const canonicalExisting = new Map();
  for (const item of discoveries) {
    const fp = discoveryFingerprint(item) || item.id;
    const prior = canonicalExisting.get(fp);
    if (!prior) {
      canonicalExisting.set(fp, item);
      continue;
    }
    const priorReviewed = ["added", "dismissed"].includes(prior.status);
    const itemReviewed = ["added", "dismissed"].includes(item.status);
    if (itemReviewed && !priorReviewed) canonicalExisting.set(fp, item);
    else if (itemReviewed === priorReviewed && Date.parse(item.reviewedAt || 0) > Date.parse(prior.reviewedAt || 0)) canonicalExisting.set(fp, item);
  }
  discoveries = Array.from(canonicalExisting.values());

  const byId = new Map(discoveries.map(item => [item.id, item]));
  const byFingerprint = new Map(discoveries.map(item => [discoveryFingerprint(item), item]).filter(([key]) => key));
  const reviewedByBroadcast = new Map();
  for (const item of discoveries) {
    const key = reviewedBroadcastKey(item);
    if (key && ["added", "dismissed"].includes(item.status)) {
      const list = reviewedByBroadcast.get(key) || [];
      list.push(item);
      reviewedByBroadcast.set(key, list);
    }
  }

  for (const ep of incoming || []) {
    if (!ep?.id) continue;
    const showKey = normalizeTrackedName(ep.show || ep.trackedTitle);
    const stalePending = [...byId.values()].find(item =>
      !["added", "dismissed"].includes(item.status) &&
      normalizeTrackedName(item.show || item.trackedTitle) === showKey &&
      String(item.season ?? "") === String(ep.season ?? "") &&
      String(item.number ?? "") === String(ep.number ?? "") &&
      item.airdate && ep.airdate && item.airdate !== ep.airdate
    );
    if (stalePending) {
      byId.delete(stalePending.id);
      byFingerprint.delete(discoveryFingerprint(stalePending));
    }
    let previous = byId.get(ep.id) || byFingerprint.get(discoveryFingerprint(ep));

    // A late/stale provider can report the same broadcast date under a different
    // episode number. If that show/date has already been reviewed, preserve the
    // reviewed result instead of resurrecting it as a new card.
    if (!previous) {
      const candidates = reviewedByBroadcast.get(reviewedBroadcastKey(ep)) || [];
      previous = candidates.find(item => sameReviewedBroadcast(item, ep)) || null;
    }

    const merged = previous
      ? { ...ep, status: previous.status, reviewedAt: previous.reviewedAt, id: previous.id || ep.id }
      : { ...ep, status: "pending" };
    byId.set(merged.id, merged);
    byFingerprint.set(discoveryFingerprint(merged), merged);

    const broadcastKey = reviewedBroadcastKey(merged);
    if (broadcastKey && ["added", "dismissed"].includes(merged.status)) {
      const list = reviewedByBroadcast.get(broadcastKey) || [];
      if (!list.some(item => item.id === merged.id)) list.push(merged);
      reviewedByBroadcast.set(broadcastKey, list);
    }
  }
  const unique = new Map();
  for (const item of byId.values()) unique.set(discoveryFingerprint(item) || item.id, item);
  discoveries = Array.from(unique.values()).slice(-800);
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
  if (!last || !parseLocalDate(last)) return [];
  if (last < yesterday) {
    let start = addDays(last, 1);
    const gap = daysBetween(start, yesterday);
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

async function discoverDate(date, { batchSize = 5 } = {}) {
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

  for (let i = 0; i < trackedShows.length; i += DISCOVERY_BATCH_SIZE) {
    const shows = trackedShows.slice(i, i + DISCOVERY_BATCH_SIZE);
    const payload = await workerFetch("/api/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, maxAirdate, shows })
    });
    if (Array.isArray(payload.episodes)) {
      allEpisodes.push(...payload.episodes.filter(ep => ep?.airdate === date));
    }
    if (Array.isArray(payload.resolvedShows)) allResolvedShows.push(...payload.resolvedShows);
  }

  const payload = { episodes: allEpisodes, resolvedShows: allResolvedShows };
  mergeDiscoveries(allEpisodes);
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
  localStorage.setItem(lastTvEpisodeDateStorageKey, date);
  localStorage.setItem(lastTvCheckStorageKey, todayString());
  return payload;
}

async function discoverYesterday({ automatic = false } = {}) {
  if (tvSearchBusy || !getWorkerUrl() || !trackedShows.length) return;
  tvSearchBusy = true;
  checkTvBtn.disabled = true;
  checkTvBtn.textContent = "Checking…";
  const dates = rollingRecheckDates(3);
  const trace = [`Started ${new Date().toISOString()} · dates ${dates.join(", ")}`, rollingTraceSnapshot("before loop")];
  writeRollingTrace(trace);
  tvDiscoveryStatus.textContent = `Checking recent TV…`;
  try {
    for (const date of dates) {
      const payload = await discoverDate(date);
      trace.push(`${date} response: ${(payload.episodes || []).map(ep => `${ep.show || ep.trackedTitle} ${episodeNumberLabel(ep)} ${ep.airdate}`).join(" | ") || "no episodes"}`);
      trace.push(rollingTraceSnapshot(`after ${date}`));
      writeRollingTrace(trace);
    }
    renderTrackedShows();
    renderDiscoveries();
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
}

async function catchUpDiscoveries({ automatic = false } = {}) {
  if (tvSearchBusy || !getWorkerUrl() || !trackedShows.length) return;
  const dates = catchUpDates();
  if (!dates.length) {
    renderDiscoveries();
    await checkFranchiseCandidates();
    return;
  }
  tvSearchBusy = true;
  checkTvBtn.disabled = true;
  checkTvBtn.textContent = "Catching up…";
  try {
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      tvDiscoveryStatus.textContent = dates.length === 1
        ? `Checking ${formatAirdate(date)}…`
        : `Catching up ${i + 1} of ${dates.length} · ${formatAirdate(date)}…`;
      await discoverDate(date, { batchSize: 12 });
    }
    renderTrackedShows();
    renderDiscoveries();
  } catch (error) {
    tvDiscoveryStatus.textContent = automatic ? `Automatic catch-up paused: ${error.message}` : error.message;
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
  if (debugDateInput && !debugDateInput.value) debugDateInput.value = yesterdayString();
  refreshDebugShowOptions();

  // Catch up missed airdates (up to 30 days) and always recheck the latest 3 air dates on app open.
  // No wheel state changes occur until Julie explicitly approves an episode.
  if (getWorkerUrl() && trackedShows.length) {
    (async () => {
      await catchUpDiscoveries({ automatic: true });
      // Catch-up and rolling recheck serve different jobs. Always recheck the latest
      // three completed air dates after catch-up so yesterday cannot be skipped merely
      // because the catch-up cursor says the app is current.
      await discoverYesterday({ automatic: true });
    })();
  }
}

initTrackedTvDisclosure();
initTvDiscovery();

// v0.2.16: refresh diagnostics after localStorage-backed tracked state has initialized.
queueMicrotask(() => refreshDebugShowOptions());
window.addEventListener("pageshow", () => refreshDebugShowOptions());

// v0.2.19: aggressively check for a newly deployed service worker/app shell.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) await registration.update();
    } catch {}
  });
}

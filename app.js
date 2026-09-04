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
let movies = load();
let lastState = null;
let selectedIndex = null;
let rotation = -Math.PI / 2;
let spinning = false;
let dragging = false;
let dragPointerId = null;
let lastDragAngle = 0;
let lastDragTime = 0;
let dragVelocity = 0;

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
const checkTvBtn = document.getElementById("checkTvBtn");
const discoveryList = document.getElementById("discoveryList");
const tvDiscoveryStatus = document.getElementById("tvDiscoveryStatus");
const discoveryActions = document.getElementById("discoveryActions");
const addAllDiscoveriesBtn = document.getElementById("addAllDiscoveriesBtn");
const dismissAllDiscoveriesBtn = document.getElementById("dismissAllDiscoveriesBtn");
const trackedShowList = document.getElementById("trackedShowList");
const trackedShowInput = document.getElementById("trackedShowInput");
const searchTrackedShowBtn = document.getElementById("searchTrackedShowBtn");
const trackedSearchResults = document.getElementById("trackedSearchResults");
const workerUrlInput = document.getElementById("workerUrlInput");
const saveWorkerBtn = document.getElementById("saveWorkerBtn");
const workerStatus = document.getElementById("workerStatus");
const franchiseCandidateList = document.getElementById("franchiseCandidateList");

let trackedShows = loadJsonArray(trackedShowsStorageKey);
let discoveries = loadJsonArray(discoveriesStorageKey);
let tvSearchBusy = false;

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
function totalWeight() { return movies.reduce((sum, m) => sum + m.weight, 0); }

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
    r -= movies[i].weight;
    if (r < 0) return i;
  }
  return movies.length - 1;
}

function segmentCenter(index) {
  const total = totalWeight();
  let start = 0;
  for (let i = 0; i < index; i++) start += movies[i].weight / total * Math.PI * 2;
  const arc = movies[index].weight / total * Math.PI * 2;
  return start + arc / 2;
}

function normalizedAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function shortestAngleChange(from, to) {
  let change = to - from;
  if (change > Math.PI) change -= Math.PI * 2;
  if (change < -Math.PI) change += Math.PI * 2;
  return change;
}

function pointerAngleForEvent(event) {
  const bounds = canvas.getBoundingClientRect();
  return Math.atan2(
    event.clientY - (bounds.top + bounds.height / 2),
    event.clientX - (bounds.left + bounds.width / 2)
  );
}

function itemIndexAtPointer(wheelRotation = rotation) {
  const pointerAngle = -Math.PI / 2;
  const wheelAngle = normalizedAngle(pointerAngle - wheelRotation);
  const total = totalWeight();
  let end = 0;
  for (let i = 0; i < movies.length; i++) {
    end += movies[i].weight / total * Math.PI * 2;
    if (wheelAngle < end) return i;
  }
  return movies.length - 1;
}

function finishSpin(index) {
  if (index == null || !movies[index]) return;
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

function beginManualSpin(event) {
  if (spinning || !movies.length || (event.pointerType === "mouse" && event.button !== 0)) return;
  dragging = true;
  dragPointerId = event.pointerId;
  lastDragAngle = pointerAngleForEvent(event);
  lastDragTime = event.timeStamp;
  dragVelocity = 0;
  spinBtn.disabled = true;
  watchedBtn.disabled = true;
  winnerEl.setAttribute?.("aria-live", "off");
  setWinner(movies[itemIndexAtPointer(rotation)].title);
  canvas.classList.add("dragging");
  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function moveManualSpin(event) {
  if (!dragging || event.pointerId !== dragPointerId) return;
  const angle = pointerAngleForEvent(event);
  const change = shortestAngleChange(lastDragAngle, angle);
  const elapsed = Math.max(1, event.timeStamp - lastDragTime);
  rotation += change;
  dragVelocity = dragVelocity * .55 + (change / elapsed) * .45;
  setWinner(movies[itemIndexAtPointer(rotation)].title);
  lastDragAngle = angle;
  lastDragTime = event.timeStamp;
  drawWheel();
  event.preventDefault();
}

function endManualSpin(event) {
  if (!dragging || event.pointerId !== dragPointerId) return;
  dragging = false;
  dragPointerId = null;
  canvas.classList.remove("dragging");
  canvas.releasePointerCapture?.(event.pointerId);
  event.preventDefault();
  let velocity = Math.max(-.045, Math.min(.045, dragVelocity));
  let previousTime = performance.now();
  const startedAt = previousTime;
  spinning = true;

  function coast(now) {
    const elapsed = Math.min(34, Math.max(1, now - previousTime));
    previousTime = now;
    rotation += velocity * elapsed;
    velocity *= Math.pow(.94, elapsed / 16.67);
    setWinner(movies[itemIndexAtPointer(rotation)].title);
    drawWheel();
    if (Math.abs(velocity) > .00008 && now - startedAt < 2600) {
      requestAnimationFrame(coast);
    } else {
      rotation = normalizedAngle(rotation);
      finishSpin(itemIndexAtPointer(rotation));
    }
  }
  requestAnimationFrame(coast);
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
    const arc = movie.weight / total * Math.PI * 2;
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
      ctx.font = '600 18px Quicksand, "Avenir Next", ui-rounded, -apple-system, sans-serif';
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
    const pct = Math.round(movie.weight / total * 100);
    row.innerHTML = `<div class="movie-title">${escapeHtml(movie.title)} <span class="tiny">${pct}%</span></div><div class="weight">${movie.weight}</div><button class="remove" aria-label="Remove ${escapeHtml(movie.title)}">Remove</button>`;
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

canvas.addEventListener("pointerdown", beginManualSpin);
canvas.addEventListener("pointermove", moveManualSpin);
canvas.addEventListener("pointerup", endManualSpin);
canvas.addEventListener("pointercancel", endManualSpin);

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
  return discoveries.filter(item => (item.kind || "episode") === "episode" && item.status !== "added" && item.status !== "dismissed");
}

function pendingFranchiseCandidates() {
  return discoveries.filter(item => item.kind === "series-candidate" && item.status !== "added" && item.status !== "dismissed");
}

function renderDiscoveries() {
  discoveryList.innerHTML = "";
  franchiseCandidateList.innerHTML = "";
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
  movies.push({ title: episodeWheelTitle(ep), weight: 1, locked: false });
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
    movies.push({ title: episodeWheelTitle(ep), weight: 1, locked: false });
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
  if (!trackedShows.some(item => Number(item.tvmazeId) === Number(candidate.tvmazeId))) {
    trackedShows.push({
      title: candidate.show,
      canonicalName: candidate.show,
      tvmazeId: candidate.tvmazeId,
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

  trackedShows.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "tracked-row";
    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "tracked-name";
    name.textContent = item.canonicalName || item.title;
    const detail = document.createElement("div");
    detail.className = "tracked-detail";
    const franchise = item.kind === "franchise" ? "Franchise watch" : "Show";
    detail.textContent = [franchise, item.network || (item.tvmazeId ? `TVmaze #${item.tvmazeId}` : "Tracked")].filter(Boolean).join(" · ");
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
      detail.textContent = [result.network, result.premiered ? `started ${result.premiered.slice(0, 4)}` : "", result.status].filter(Boolean).join(" · ");
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
}

function addTrackedResult(result, kind) {
  const existing = trackedShows.find(item => Number(item.tvmazeId) === Number(result.id));
  if (existing) {
    if (kind === "franchise") existing.kind = "franchise";
  } else {
    trackedShows.push({
      title: result.name,
      canonicalName: result.name,
      tvmazeId: result.id,
      network: result.network || null,
      kind
    });
  }
  saveTrackedShows();
  trackedShowInput.value = "";
  trackedSearchResults.innerHTML = "";
  renderTrackedShows();
  renderDiscoveries();
  if (kind === "franchise") checkFranchiseCandidates({ force: true });
}

function mergeDiscoveries(incoming) {
  const byId = new Map(discoveries.map(item => [item.id, item]));
  for (const ep of incoming || []) {
    if (!ep?.id) continue;
    const previous = byId.get(ep.id);
    byId.set(ep.id, previous ? { ...ep, status: previous.status, reviewedAt: previous.reviewedAt } : { ...ep, status: "pending" });
  }
  discoveries = Array.from(byId.values()).slice(-800);
  saveDiscoveries();
}

function migrateOldCheckState() {
  if (localStorage.getItem(lastTvEpisodeDateStorageKey)) return;
  const oldCheck = localStorage.getItem(lastTvCheckStorageKey);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(oldCheck || "")) return;
  const oldEpisodeDate = addDays(oldCheck, -1);
  if (oldEpisodeDate) localStorage.setItem(lastTvEpisodeDateStorageKey, oldEpisodeDate);
}

function catchUpDates() {
  const yesterday = yesterdayString();
  const last = localStorage.getItem(lastTvEpisodeDateStorageKey);
  if (!last || !parseLocalDate(last)) return [yesterday];
  if (last >= yesterday) return [];
  let start = addDays(last, 1);
  const gap = daysBetween(start, yesterday);
  if (gap > 29) start = addDays(yesterday, -29);
  const dates = [];
  for (let cursor = start; cursor && cursor <= yesterday; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

async function discoverDate(date) {
  const payload = await workerFetch("/api/discover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ date, shows: trackedShows })
  });
  mergeDiscoveries(payload.episodes || []);
  if (Array.isArray(payload.resolvedShows)) {
    for (const resolved of payload.resolvedShows) {
      const item = trackedShows.find(x => x.title === resolved.title || x.canonicalName === resolved.title);
      if (item && resolved.tvmazeId) {
        item.tvmazeId = resolved.tvmazeId;
        item.canonicalName = resolved.canonicalName || item.canonicalName || item.title;
      }
    }
    saveTrackedShows();
  }
  localStorage.setItem(lastTvEpisodeDateStorageKey, date);
  localStorage.setItem(lastTvCheckStorageKey, todayString());
  return payload;
}

async function discoverYesterday({ automatic = false } = {}) {
  if (tvSearchBusy || !getWorkerUrl() || !trackedShows.length) return;
  tvSearchBusy = true;
  checkTvBtn.disabled = true;
  checkTvBtn.textContent = "Checking…";
  tvDiscoveryStatus.textContent = `Checking ${formatAirdate(yesterdayString())}…`;
  try {
    await discoverDate(yesterdayString());
    renderTrackedShows();
    renderDiscoveries();
  } catch (error) {
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
      await discoverDate(date);
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
  const franchises = trackedShows.filter(item => item.kind === "franchise" && item.tvmazeId);
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

  // Catch up every missed airdate, up to 30 days, when the app opens.
  // No wheel state changes occur until Julie explicitly approves an episode.
  if (getWorkerUrl() && trackedShows.length) {
    catchUpDiscoveries({ automatic: true });
  }
}

initTvDiscovery();

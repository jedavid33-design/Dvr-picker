const defaultMovies = [
  "Test 1",
  "Test 2",
  "Test 3",
  "🎲 Second Spin"
];

const colors = ["#99b8bb", "#b4a4c7", "#8fb3c0", "#c4a3b1", "#aaa5c9", "#8bb4aa", "#b8a68d", "#9aa9cf", "#bda0bc", "#86afc0"];
const storageKey = "bedtimeMovieWheel.v2";
const lastSpinStorageKey = "dvrPicker.lastSpin.v1";
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
      ctx.font = '600 18px "Avenir Next", Avenir, "Helvetica Neue", ui-rounded, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
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

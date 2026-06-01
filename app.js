const defaultMovies = [
  "Test 1",
  "Test 2",
  "Test 3",
  "🎲 Second Spin"
];

const colors = ["#a9c1b2", "#edd49f", "#e4ae99", "#e8bab0", "#a9a8c8", "#abc0d2", "#a4bdad", "#ebcf93", "#e9b3a0", "#c4b2dc"];
const storageKey = "bedtimeMovieWheel.v2";
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
const deleteBtn = document.getElementById("deleteBtn");
const undoBtn = document.getElementById("undoBtn");
const resetBtn = document.getElementById("resetBtn");
const movieList = document.getElementById("movieList");
const totalSlices = document.getElementById("totalSlices");
const newMovie = document.getElementById("newMovie");
const addBtn = document.getElementById("addBtn");
const dialog = document.getElementById("confirmDialog");

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
  winnerEl.textContent = "Spinning...";

  function animate(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 4);
    rotation = start + change * eased;
    drawWheel();
    if (t < 1) requestAnimationFrame(animate);
    else {
      spinning = false;
      rotation = targetRotation % (Math.PI * 2);
      winnerEl.textContent = movies[selectedIndex].title;
      spinBtn.disabled = false;
      watchedBtn.disabled = false;
      deleteBtn.disabled = false;
      drawWheel();
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

  updateWeights();

  selectedIndex = null;
  watchedBtn.disabled = true;
  deleteBtn.disabled = true;

  save();
  render();
}

function watchedAndDelete() {
  if (selectedIndex == null) return;

  lastState = JSON.stringify(movies);

  updateWeights();

  movies = movies.filter((m, i) => i !== selectedIndex || m.locked);

  selectedIndex = null;
  watchedBtn.disabled = true;
  deleteBtn.disabled = true;

  save();
  render();
}
function undo() {
  if (!lastState) return;
  movies = JSON.parse(lastState);
  lastState = null;
  selectedIndex = null;
  winnerEl.textContent = "Undone";
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
      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.font = "700 18px system-ui, sans-serif";
      const label = movie.title.length > 24 ? movie.title.slice(0, 23) + "…" : movie.title;
      ctx.fillText(label, radius - 18, 7);
      ctx.restore();
    }
    start += arc;
  });
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, size * .13, 0, Math.PI * 2);
  ctx.fillStyle = "white";
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
  totalSlices.textContent = `${total} slices`;
  movies.forEach((movie, index) => {
    const row = document.createElement("div");
    row.className = "movie-row";
    const pct = Math.round(movie.weight / total * 100);
    row.innerHTML = `<div class="movie-title">${escapeHtml(movie.title)} <span class="tiny">${pct}%</span></div><div class="weight">${movie.weight}</div><button class="remove" aria-label="Remove ${escapeHtml(movie.title)}">Remove</button>`;
    row.querySelector(".remove").onclick = () => {
      lastState = JSON.stringify(movies);
      movies.splice(index, 1);
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
deleteBtn.onclick = watchedAndDelete;
undoBtn.onclick = undo;
resetBtn.onclick = () => dialog.showModal();
document.getElementById("cancelReset").onclick = () => dialog.close();
document.getElementById("confirmReset").onclick = () => {
  lastState = JSON.stringify(movies);
  movies = freshDefaults();
  selectedIndex = null;
  winnerEl.textContent = "Reset";
  watchedBtn.disabled = true;
deleteBtn.disabled = true;
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

render();

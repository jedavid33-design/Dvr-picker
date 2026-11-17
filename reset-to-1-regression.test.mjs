// Regression tests for v0.2.74 "Reset to 1":
//  - records today's local date as the entry's last-watched date and restarts
//    its aging clock on the existing 20%-accelerating increment curve
//    (1.0 today, 2.0 after 1 day, 3.2, 4.64, 6.368, ...)
//  - keeps the entry, its wheel position, and its other metadata
//  - Undo restores the previous weight and last-watched date
//  - lastWatchedAt persists through the load() mapping; legacy entries load
//    with lastWatchedAt null
// Run: node reset-to-1-regression.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "app.js"), "utf8");
const html = readFileSync(join(here, "index.html"), "utf8");

let failures = 0;
function check(name, ok, details = "") {
  if (ok) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name} ${details}`); }
}
const approx = (a, b) => Math.abs(a - b) < 1e-9;

// Controllable local "today" for the extracted helpers.
const BASE = "2026-11-16";
let dayOffset = 0;
function datePlus(base, days) {
  const d = new Date(base + "T12:00:00");
  d.setDate(d.getDate() + days);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
globalThis.todayString = () => datePlus(BASE, dayOffset);

// Extract the pure weight helpers (they read todayString at call time).
const wFrom = src.indexOf("function localDayNumber(");
const wTo = src.indexOf("function totalWeight");
if (wFrom < 0 || wTo < wFrom) throw new Error("Weight helper boundaries missing");
const { automaticGrowthForDays, effectiveWeight } =
  new Function(`${src.slice(wFrom, wTo)}\nreturn { automaticGrowthForDays, effectiveWeight };`)();

// Extract freshDefaults + load with a stubbed localStorage.
globalThis.defaultMovies = ["Example Show", "🎲 Second Spin"];
globalThis.storageKey = "dvrWheelTestKey";
let stored = null;
globalThis.localStorage = {
  getItem: () => stored,
  setItem: (k, v) => { stored = v; },
  removeItem: () => { stored = null; }
};
const lFrom = src.indexOf("function freshDefaults(");
const lTo = src.indexOf("// M6:");
if (lFrom < 0 || lTo < lFrom) throw new Error("load() boundaries missing");
const { load } = new Function(`${src.slice(lFrom, lTo)}\nreturn { load };`)();

// The exact mutations markResetTo1 performs on the selected entry.
function applyResetTo1(movie) {
  movie.weight = 1;
  movie.lastWatchedAt = todayString();
}

// --- The curve itself (Julie's example values) ---
check("curve day 0 = 1.0", approx(automaticGrowthForDays(0), 1));
check("curve day 1 = 2.0", approx(automaticGrowthForDays(1), 2));
check("curve day 2 = 3.2", approx(automaticGrowthForDays(2), 3.2));
check("curve day 3 = 4.64 (~4.6)", approx(automaticGrowthForDays(3), 4.64));
check("curve day 4 = 6.368 (~6.4)", approx(automaticGrowthForDays(4), 6.368));

// --- TV entry aging from an old airdate ---
dayOffset = 0;
const tv = { title: "ER — S1 E5", weight: 1, airdate: datePlus(BASE, -10), addedAt: null, autoWeightStartedAt: null, lastWatchedAt: null };
check("airdate entry ages from airdate before reset", approx(effectiveWeight(tv), automaticGrowthForDays(10)));
applyResetTo1(tv);
check("reset sets weight to 1.0", tv.weight === 1);
check("reset records today as last-watched", tv.lastWatchedAt === BASE);
check("effective weight is 1.0 on the reset day", approx(effectiveWeight(tv), 1));
dayOffset = 1; check("1 day after reset = 2.0", approx(effectiveWeight(tv), 2));
dayOffset = 2; check("2 days after reset = 3.2", approx(effectiveWeight(tv), 3.2));
dayOffset = 3; check("3 days after reset = 4.64", approx(effectiveWeight(tv), 4.64));
dayOffset = 4; check("4 days after reset = 6.368", approx(effectiveWeight(tv), 6.368));
check("airdate metadata preserved", tv.airdate === datePlus(BASE, -10));

// --- Manual entry aging from its added date ---
dayOffset = 0;
const manual = { title: "The West Wing", weight: 1, airdate: null, addedAt: datePlus(BASE, -30), autoWeightStartedAt: datePlus(BASE, -30), lastWatchedAt: null };
check("manual entry ages from added date before reset", approx(effectiveWeight(manual), automaticGrowthForDays(30)));
applyResetTo1(manual);
check("manual entry is 1.0 on the reset day", approx(effectiveWeight(manual), 1));
dayOffset = 1; check("manual entry is 2.0 the next day", approx(effectiveWeight(manual), 2));
check("added dates preserved", manual.addedAt === datePlus(BASE, -30) && manual.autoWeightStartedAt === datePlus(BASE, -30));

// --- A second Reset to 1 restarts the clock ---
dayOffset = 3;
check("entry has aged to 4.64 before second reset", approx(effectiveWeight(manual), 4.64));
applyResetTo1(manual);
check("second reset returns to 1.0", approx(effectiveWeight(manual), 1));
check("second reset moves last-watched to the new today", manual.lastWatchedAt === datePlus(BASE, 3));
dayOffset = 4; check("day after second reset = 2.0", approx(effectiveWeight(manual), 2));

// --- Undo restores the previous weight and last-watched date ---
dayOffset = 0;
const undoable = [{ title: "ER — S1 E6", weight: 3, airdate: null, addedAt: datePlus(BASE, -5), autoWeightStartedAt: datePlus(BASE, -5), lastWatchedAt: datePlus(BASE, -5) }];
const snapshot = JSON.stringify(undoable);
applyResetTo1(undoable[0]);
check("reset changed the entry", undoable[0].weight === 1 && undoable[0].lastWatchedAt === BASE);
const restored = JSON.parse(snapshot);
check("undo restores previous weight", restored[0].weight === 3);
check("undo restores previous last-watched date", restored[0].lastWatchedAt === datePlus(BASE, -5));
check("undo restores previous effective weight", approx(effectiveWeight(restored[0]), automaticGrowthForDays(5)));
const fresh = [{ title: "New Show", weight: 1, airdate: null, addedAt: BASE, autoWeightStartedAt: BASE }];
const freshSnapshot = JSON.stringify(fresh);
applyResetTo1(fresh[0]);
const freshRestored = JSON.parse(freshSnapshot);
check("undo of a first reset restores no last-watched date", !freshRestored[0].lastWatchedAt);

// --- Persistence through load() ---
stored = JSON.stringify([
  { title: "The West Wing", weight: 1, airdate: null, addedAt: datePlus(BASE, -30), autoWeightStartedAt: datePlus(BASE, -30), lastWatchedAt: BASE },
  { title: "Legacy Entry", weight: 2, airdate: null, addedAt: BASE, autoWeightStartedAt: BASE },
  { title: "Corrupt Date", weight: 1, lastWatchedAt: "not-a-date" }
]);
dayOffset = 0;
const loaded = load();
check("load preserves lastWatchedAt", loaded[0].lastWatchedAt === BASE);
check("loaded reset entry weighs 1.0 today", approx(effectiveWeight(loaded[0]), 1));
check("legacy entry loads with lastWatchedAt null", loaded[1].lastWatchedAt === null);
check("corrupt lastWatchedAt loads as null", loaded[2].lastWatchedAt === null);

// --- Locked entry is never re-weighted by a last-watched date ---
const locked = { title: "🎲 Second Spin", weight: 1, locked: true, lastWatchedAt: datePlus(BASE, -9) };
check("locked entry keeps its stored weight", effectiveWeight(locked) === 1);

// --- Wiring / markup (static) ---
check("button exists in the actions row, initially disabled",
  html.includes('<button id="resetTo1Btn" disabled>Reset to 1</button>'));
check("button is wired to markResetTo1", src.includes("resetTo1Btn.onclick = markResetTo1;"));
const handlerStart = src.indexOf("function markResetTo1(");
const handler = handlerStart >= 0 ? src.slice(handlerStart, handlerStart + 900) : "";
check("handler snapshots state for Undo", handler.includes("lastState = JSON.stringify(movies);"));
check("handler refuses locked entries", handler.includes("movie.locked"));
check("handler refuses to run while spinning", handler.includes("spinning"));
check("handler sets weight 1 and lastWatchedAt today",
  handler.includes("movie.weight = 1;") && handler.includes("movie.lastWatchedAt = todayString();"));
check("handler clears the selection like Watched",
  handler.includes("selectedIndex = null;") && handler.includes("clearLastSpin();"));
const syncStart = src.indexOf("function syncResetTo1Btn(");
const syncBody = syncStart >= 0 ? src.slice(syncStart, syncStart + 260) : "";
check("disable rule covers spinning, no selection, Second Spin",
  syncBody.includes("spinning") && syncBody.includes("selectedIndex == null") && syncBody.includes("locked"));
check("button state syncs on spin start, spin finish, and render",
  (src.match(/syncResetTo1Btn\(\);/g) || []).length >= 3);
check("cache-bust + build refs at v0.2.74",
  html.includes("app.js?v=0.2.74") && html.includes(">v0.2.74<"));

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);

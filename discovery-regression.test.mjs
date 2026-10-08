// Regression tests for Tracked TV initial-backfill episode identity.
// Run: node discovery-regression.test.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "app.js"), "utf8");
// Evaluate only the pure discovery helpers, not the DOM-dependent application.
const from = src.indexOf("function normalizeTrackedName(");
const to = src.indexOf("function mergeDiscoveries(incoming)");
if (from < 0 || to < from) throw new Error("Discovery helper boundaries missing");
const helpers = new Function(`${src.slice(from, to)}
return { collapseDuplicateEpisodeDiscoveries };`)();

let failures = 0;
function check(name, ok, details = "") {
  if (ok) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name} ${details}`);
  }
}

function episode(season, number, airdate, status = "pending", title = `Episode ${number}`, show = "Hell's Kitchen") {
  return {
    id: `${show}:${season}:${number}:${airdate}`,
    trackedTitle: show, show, season, number, airdate, title, status,
    reviewedAt: status === "pending" ? null : "2026-10-08T10:00:00Z"
  };
}
const collapse = helpers.collapseDuplicateEpisodeDiscoveries;
const duplicates = collapse([
  episode(25, 1, "2026-09-24"),
  episode(25, 1, "2026-09-25"),
  episode(25, 2, "2026-10-01"),
  episode(25, 2, "2026-10-02")
]);
check("backfill removes Hell's Kitchen adjacent-date duplicates", duplicates.length === 2);
check("backfill retains original earlier broadcast dates",
  duplicates[0]?.airdate === "2026-09-24" && duplicates[1]?.airdate === "2026-10-01");

check("keeps a previously dismissed episode dismissed",
  collapse([episode(25, 1, "2026-09-24"), episode(25, 1, "2026-09-25", "dismissed")])[0]?.status === "dismissed");
check("keeps an already added episode added",
  collapse([episode(25, 1, "2026-09-24", "added"), episode(25, 1, "2026-09-25")])[0]?.status === "added");
check("keeps separate same-day S/E broadcasts",
  collapse([episode(25, 1, "2026-09-24"), episode(25, 2, "2026-09-24")]).length === 2);
check("does not cross-dedupe different shows",
  collapse([episode(25, 1, "2026-09-24"), episode(25, 1, "2026-09-25", "pending", "Episode 1", "Other Show")]).length === 2);
check("keeps unnumbered records until corroborated",
  collapse([{ show: "Test", season: null, number: null }, { show: "Test", season: null, number: null }]).length === 2);
check("prefers descriptive title when the earlier entry was a stub",
  collapse([episode(25, 1, "2026-09-24"), episode(25, 1, "2026-09-25", "pending", "25th Premiere Party")])[0]?.title === "25th Premiere Party");

if (failures) {
  console.log(`${failures} failure(s)`);
  process.exit(1);
}
console.log("All discovery tests passed.");

// On-demand search: "what do we know near <place>, and if too little, go find it."
//   node --env-file=.env ingest/search.ts "Julian"
//   node --env-file=.env ingest/search.ts "92036" --dry-run     coverage only, spends nothing
//   node --env-file=.env ingest/search.ts "Campo" --force --load  search even if covered, then load to the Neon branch
//
// This is the gap-fill process. A live call never crawls (it reads the database). When a caller asks about a place we
// know little about, the agent answers from the nearest known sites and queues this command for that place, so the next
// caller gets verified data. Every record found here goes through the same verification gate as the batch pipeline.
import { appendFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { geocode } from "./geocode.ts";

const place = process.argv[2];
const flag = (f: string) => process.argv.includes(f);
const ri = process.argv.indexOf("--radius");
const RADIUS_KM = ri >= 0 ? Number(process.argv[ri + 1]) || 10 : 10;
const ENOUGH = 3; // sites within the radius before we call a place "covered"
if (!place || place.startsWith("--")) {
  console.error('usage: search.ts "<place, zip or address>" [--dry-run] [--force] [--load] [--radius km]');
  process.exit(1);
}

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = (d: number) => (d * Math.PI) / 180, R = 6371;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Census geocoder handles street addresses; zips and town names fall back to OpenStreetMap's Nominatim.
async function locate(q: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const c = /\d{2,5}\s+\w+/.test(q) && !/^\d{5}$/.test(q.trim()) ? await geocode(q) : null;
  if (c) return { ...c, label: q };
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(/^\d{5}$/.test(q.trim()) ? `${q}, California` : `${q}, San Diego County, California`)}`,
    { headers: { "User-Agent": "shade-ingest/1.0" }, signal: AbortSignal.timeout(20_000) },
  );
  const j: any[] = await res.json().catch(() => []);
  return j[0] ? { lat: Number(j[0].lat), lon: Number(j[0].lon), label: j[0].display_name } : null;
}

async function coverage(at: { lat: number; lon: number }) {
  const seed = JSON.parse(await readFile(new URL("../data/seed/sites.json", import.meta.url), "utf8").catch(() => "[]"));
  const extras = JSON.parse(await readFile(new URL("../data/seed/sites.extras.json", import.meta.url), "utf8").catch(() => "{}"));
  const ranked = seed.map((s: any) => ({ ...s, km: km(at, s), verification: extras[s.id]?.verification }))
    .sort((a: any, b: any) => a.km - b.km);
  return { all: ranked, near: ranked.filter((s: any) => s.km <= RADIUS_KM) };
}

function show(label: string, c: Awaited<ReturnType<typeof coverage>>) {
  console.log(`${label}: ${c.near.length} site(s) within ${RADIUS_KM} km | official ${c.near.filter((s: any) => s.tier === "official").length}, confirmed ${c.near.filter((s: any) => s.hours_confirmed_on_source).length}`);
  for (const s of c.all.slice(0, 4)) console.log(`   ${s.km.toFixed(1).padStart(5)} km  ${s.tier.padEnd(10)} ${s.name}${s.hours_confirmed_on_source ? "  ✓ hours confirmed" : ""}`);
}

function step(title: string, args: string[], env: Record<string, string> = {}) {
  console.log(`\n▶ ${title}`);
  const r = spawnSync("node", ["--env-file=.env", ...args], {
    stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1", ...env }, timeout: 20 * 60_000,
  });
  const out = (r.stdout + r.stderr).split("\n").filter((l) => l.trim() && !/^[✓–]/.test(l)).slice(-4);
  out.forEach((l) => console.log("  " + l.slice(0, 170)));
  if (r.status !== 0) console.log(`  (step exited ${r.status}; continuing)`);
}

async function main() {
  const at = await locate(place);
  if (!at) { console.error(`could not locate "${place}"`); process.exit(2); }
  console.log(`"${place}" → ${at.lat.toFixed(4)}, ${at.lon.toFixed(4)}  (${at.label.slice(0, 70)})`);

  const before = await coverage(at);
  show("BEFORE", before);
  const gap = before.near.length < ENOUGH;
  console.log(gap ? `→ coverage gap (< ${ENOUGH} sites within ${RADIUS_KM} km)` : "→ covered");
  if (flag("--dry-run") || (!gap && !flag("--force"))) return;

  step(`Google Maps around ${place}`, ["ingest/maps.ts", "--at", `${at.lat},${at.lon}`, "--name", place]);
  step(`official pages for ${place}`, ["ingest/official.ts", "60"], { PLACE: place });
  step("fetch each site's own page", ["ingest/fetch-maps-sites.ts", "400"]);
  step("extract (cached pages are free)", ["ingest/extract.ts"], { EXTRACT_PROVIDER: "claude" });
  step("cross-check sources", ["ingest/merge.ts"]);
  step("rebuild seed", ["ingest/to-seed.ts"]);
  if (flag("--load")) step("load into Neon branch", ["ingest/load-neon.ts"]);

  const after = await coverage(at);
  console.log("");
  show("AFTER ", after);
  const added = after.near.length - before.near.length;
  console.log(`\n${added >= 0 ? "+" : ""}${added} site(s) within ${RADIUS_KM} km`);
  await appendFile(new URL("./data/searches.jsonl", import.meta.url),
    JSON.stringify({ at: new Date().toISOString(), place, lat: at.lat, lon: at.lon, radius_km: RADIUS_KM, before: before.near.length, after: after.near.length }) + "\n");
}

main();

// Step 1b: Google Maps via Bright Data's prebuilt scraper. Returns STRUCTURED data
// (hours, lat/lon, closed flags, phone) with no LLM needed. Cheap and fast to cross-check
// against the hours Gemini reads off each site's own page.
//   node --env-file=.env ingest/maps.ts            (all demo areas)
//   node --env-file=.env ingest/maps.ts "El Cajon" (one area)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { AREAS } from "./areas.ts";

const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
if (!TOKEN) throw new Error("Set BRIGHTDATA_API_TOKEN in .env");
const DATASET = "gd_m8ebnr0q2qlklc02fz"; // "Google Maps full information"
const LIMIT = Number(process.env.MAPS_LIMIT_PER_INPUT ?? 10);
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

// Places someone can sit in out of the heat. Malls, pools and museums add long-hours AC and water.
const KEYWORDS = [
  "public library", "recreation center", "senior center", "community center", "cooling center",
  "shopping mall", "aquatic center public pool", "museum",
  "YMCA", "Boys & Girls Club", "transit center", "movie theater", "church hall community room",
];
const JUNK_CATEGORY =
  /air conditioning|heating|hvac|repair|contractor|plumb|appliance|store|\bshop\b|dealer|restaurant|insurance|attorney|real estate/i;

const DAYS: Record<string, string> = {
  Monday: "mon", Tuesday: "tue", Wednesday: "wed", Thursday: "thu", Friday: "fri", Saturday: "sat", Sunday: "sun",
};

// "8 am–5 pm", "12–7 pm", "10.00 am–5.00 pm", "Open 24 hours", "Closed", "9 am–12 pm, 1–5 pm"
function toMinutes(s: string, fallbackMeridiem?: string): { min: number; mer?: string } | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mer = m[3] ?? fallbackMeridiem;
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return { min: h * 60 + Number(m[2] ?? 0), mer: m[3] };
}
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function parseHours(open_hours: Record<string, string> | null) {
  if (!open_hours) return [];
  const out: { day: string; open: string; close: string }[] = [];
  for (const [dayName, raw] of Object.entries(open_hours)) {
    const day = DAYS[dayName];
    const txt = String(raw).replace(/[  ]/g, " ").trim();
    if (!day || /^closed$/i.test(txt)) continue;
    if (/24 hours/i.test(txt)) { out.push({ day, open: "00:00", close: "23:59" }); continue; }
    for (const range of txt.split(",")) {
      const [a, b] = range.split(/[–-]/).map((x) => x.trim());
      if (!a || !b) continue;
      const end = toMinutes(b);
      if (!end) continue;
      let start = toMinutes(a, end.mer);
      if (!start) continue;
      // "9–5 pm" parses 9 as pm; if that lands after closing, it was am.
      if (!toMinutes(a)?.mer && start.min > end.min) start = toMinutes(a, "am")!;
      out.push({ day, open: hhmm(start.min), close: hhmm(end.min) });
    }
  }
  return out;
}

// One Bright Data snapshot: trigger, poll until ready, download.
async function snapshot(input: any[]): Promise<any[]> {
  const res = await fetch(
    `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${DATASET}&type=discover_new&discover_by=location&limit_per_input=${LIMIT}&include_errors=true`,
    { method: "POST", headers: H, body: JSON.stringify(input) },
  );
  const trig = await res.json();
  if (!res.ok || !trig.snapshot_id) throw new Error(`trigger failed: ${JSON.stringify(trig).slice(0, 300)}`);
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const p = await (await fetch(`https://api.brightdata.com/datasets/v3/progress/${trig.snapshot_id}`, { headers: H })).json();
    if (p.status === "ready") break;
    if (p.status === "failed") throw new Error("snapshot failed");
  }
  console.log(`  snapshot ${trig.snapshot_id} (recoverable with maps-recover.ts if this run stops early)`);
  const data = await (await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${trig.snapshot_id}?format=json`, { headers: H })).json();
  if (!Array.isArray(data)) throw new Error(`snapshot ${trig.snapshot_id} not ready: ${JSON.stringify(data).slice(0, 80)}`);
  return data;
}

// Chunked so one failure never loses the whole run.
async function run(areas: string[]) {
  const input = areas.flatMap((area) =>
    KEYWORDS.map((keyword) => ({ country: "US", lat: AREAS[area][0], long: AREAS[area][1], zoom_level: 13, keyword })),
  );
  const CHUNK = 40;
  const rows: any[] = [];
  for (let i = 0; i < input.length; i += CHUNK) {
    const part = input.slice(i, i + CHUNK);
    try {
      const got = await snapshot(part);
      rows.push(...got);
      console.log(`chunk ${i / CHUNK + 1}/${Math.ceil(input.length / CHUNK)}: ${part.length} searches → ${got.length} rows`);
    } catch (e) {
      console.error(`chunk ${i / CHUNK + 1} failed: ${(e as Error).message}`);
    }
  }
  return rows;
}

function normalize(r: any) {
  return {
    name: r.name,
    category: r.category,
    address: r.address,
    lat: r.lat,
    lon: r.lon,
    phone: r.phone_number ?? null,
    website: r.open_website ?? null,
    hours: parseHours(r.open_hours),
    hours_raw: r.open_hours ?? null,
    temporarily_closed: !!r.temporarily_closed,
    rating: r.rating ?? null,
    reviews_count: r.reviews_count ?? null,
    popular_times: r.popular_times ?? null,
    amenities: r.business_details ?? null, // accessibility / facilities flags when Maps lists them
    source: "google_maps",
    source_url: r.url,
    place_id: r.place_id,
    fetched_at: r.timestamp ?? new Date().toISOString(),
  };
}

/** Merge Google Maps rows into data/maps_sites.json (keyed by place id, so runs only add). Also used by maps-recover.ts. */
export async function ingestRows(rows: any[]) {
  const file = new URL("./data/maps_sites.json", import.meta.url);
  const byId = new Map<string, any>();
  for (const s of JSON.parse(await readFile(file, "utf8").catch(() => "[]"))) byId.set(s.place_id, s);
  const before = byId.size;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r.place_id || r.error || r.permanently_closed) continue;
    // "cooling center" also matches HVAC businesses; keep only places someone can sit in.
    if (JUNK_CATEGORY.test(`${r.category ?? ""} ${r.name ?? ""}`)) continue;
    byId.set(r.place_id, normalize(r));
  }
  const sites = [...byId.values()];
  await mkdir(new URL("./data/", import.meta.url), { recursive: true });
  await writeFile(file, JSON.stringify(sites, null, 2));
  console.log(`${sites.length} Maps sites (${sites.length - before} new, ${sites.filter((s) => s.hours.length).length} with parsed hours) → ingest/data/maps_sites.json`);
}

async function main() {
  // Any place on demand:  --at 33.0787,-116.6012 --name Julian   (adds it to the area list for this run)
  const arg = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };
  const at = arg("--at"), name = arg("--name");
  if (at && name) { const [la, lo] = at.split(",").map(Number); AREAS[name] = [la, lo]; }
  const only = at && name ? [name] : process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== at && a !== name);
  const areas = only.length ? only : Object.keys(AREAS);
  const bad = areas.filter((a) => !AREAS[a]);
  if (bad.length) throw new Error(`unknown area(s): ${bad.join(", ")}`);
  console.log(`${areas.length} areas × ${KEYWORDS.length} keywords × up to ${LIMIT} results`);
  const rows = await run(areas);

  await ingestRows(rows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

// Step 1b: Google Maps via Bright Data's prebuilt scraper. Returns STRUCTURED data
// (hours, lat/lon, closed flags, phone) with no LLM needed. Cheap and fast to cross-check
// against the hours Gemini reads off each site's own page.
//   node --env-file=.env ingest/maps.ts            (all demo areas)
//   node --env-file=.env ingest/maps.ts "El Cajon" (one area)
import { mkdir, readFile, writeFile } from "node:fs/promises";

const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
if (!TOKEN) throw new Error("Set BRIGHTDATA_API_TOKEN in .env");
const DATASET = "gd_m8ebnr0q2qlklc02fz"; // "Google Maps full information"
const LIMIT = Number(process.env.MAPS_LIMIT_PER_INPUT ?? 5);
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const AREAS: Record<string, [number, number]> = {
  "El Cajon": [32.7948, -116.9625],
  "La Jolla": [32.8328, -117.2713],
  "City Heights": [32.7457, -117.099],
  "Chula Vista": [32.6401, -117.0842],
  Oceanside: [33.1959, -117.3795],
};
const KEYWORDS = ["public library", "recreation center", "senior center", "community center", "cooling center"];

const JUNK_CATEGORY =
  /air conditioning|heating|hvac|repair|contractor|plumb|appliance|store|shop|dealer|restaurant|insurance|attorney|real estate/i;

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

async function run(areas: string[]) {
  const input = areas.flatMap((area) =>
    KEYWORDS.map((keyword) => ({
      country: "US", lat: AREAS[area][0], long: AREAS[area][1], zoom_level: 13, keyword, _area: area,
    })),
  );
  const res = await fetch(
    `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${DATASET}&type=discover_new&discover_by=location&limit_per_input=${LIMIT}&include_errors=true`,
    { method: "POST", headers: H, body: JSON.stringify(input.map(({ _area, ...x }) => x)) },
  );
  const trig = await res.json();
  if (!res.ok || !trig.snapshot_id) throw new Error(`trigger failed: ${JSON.stringify(trig).slice(0, 300)}`);
  console.log(`snapshot ${trig.snapshot_id}, ${input.length} searches (limit ${LIMIT} each)`);

  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const p = await (await fetch(`https://api.brightdata.com/datasets/v3/progress/${trig.snapshot_id}`, { headers: H })).json();
    process.stdout.write(`  ${p.status}…\r`);
    if (p.status === "ready") break;
    if (p.status === "failed") throw new Error("snapshot failed");
  }
  const rows: any[] = await (
    await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${trig.snapshot_id}?format=json`, { headers: H })
  ).json();
  return rows;
}

async function main() {
  const only = process.argv[2];
  const areas = only ? [only] : Object.keys(AREAS);
  const rows = await run(areas);

  // Dedupe by place_id, drop closed/non-places, normalize.
  const seen = new Set<string>();
  const sites = [];
  for (const r of rows) {
    if (!r.place_id || seen.has(r.place_id) || r.error) continue;
    seen.add(r.place_id);
    if (r.permanently_closed) continue;
    // "cooling center" also matches HVAC businesses; keep only places someone can sit in.
    if (JUNK_CATEGORY.test(`${r.category ?? ""} ${r.name ?? ""}`)) continue;
    const reviews = (r.top_reviews ?? []).map((x: any) => x?.review ?? x?.text ?? "").join(" ").toLowerCase();
    sites.push({
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
      // Review text sometimes mentions AC; a weak but useful signal, flagged as such.
      review_mentions_ac: /\b(a\/c|air.?condition|cool inside|nice and cool|cooling)\b/.test(reviews) || null,
      source: "google_maps",
      source_url: r.url,
      place_id: r.place_id,
      fetched_at: r.timestamp ?? new Date().toISOString(),
    });
  }
  await mkdir(new URL("./data/", import.meta.url), { recursive: true });
  await writeFile(new URL("./data/maps_sites.json", import.meta.url), JSON.stringify(sites, null, 2));
  const withHours = sites.filter((s) => s.hours.length).length;
  console.log(`\n${sites.length} sites (${withHours} with parsed hours) → ingest/data/maps_sites.json`);
}

main();

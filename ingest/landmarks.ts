// Landmark gazetteer: named places with coordinates, so a caller can say "I'm at Geisel Library" or "outside the Price
// Center" or "Westfield UTC" and be located instantly, without being asked for a ZIP or city.
//   node --env-file=.env ingest/landmarks.ts
// Sources (all free): OpenStreetMap via the Overpass API (UCSD / La Jolla in fine detail: every named building,
// plus county-wide libraries, colleges, hospitals, malls, parks, museums, stations) and our own sites and Maps places.
// Output: data/seed/landmarks.json as [name, lat, lon, kind, weight] rows (weight: higher wins when names collide).
import { readFile, writeFile } from "node:fs/promises";

const OVERPASS = "https://overpass-api.de/api/interpreter";
const UA = { "User-Agent": "shade-landmarks/1.0", "Content-Type": "application/x-www-form-urlencoded" };

// Fine detail where we were asked to go deep: UCSD campus and La Jolla.
const UCSD_BBOX = "32.835,-117.300,32.905,-117.195";
const COUNTY_BBOX = "32.53,-117.60,33.50,-116.08";
const QUERIES: [string, string][] = [
  ["ucsd-la-jolla", `[out:json][timeout:120];(
    nw["name"]["building"](${UCSD_BBOX}); nw["name"]["amenity"](${UCSD_BBOX}); nw["name"]["leisure"](${UCSD_BBOX});
    nw["name"]["shop"](${UCSD_BBOX}); nw["name"]["tourism"](${UCSD_BBOX}); nw["name"]["office"](${UCSD_BBOX});
    nw["name"]["public_transport"](${UCSD_BBOX}); nw["name"]["railway"](${UCSD_BBOX}); nw["name"]["highway"="bus_stop"](${UCSD_BBOX});
    nw["name"]["landuse"~"education|retail"](${UCSD_BBOX}); nw["name"]["healthcare"](${UCSD_BBOX});
  ); out center tags;`],
  ["county-key", `[out:json][timeout:180];(
    nwr["name"]["amenity"~"^(library|university|college|hospital|clinic|community_centre|townhall|cinema|theatre|arts_centre|marketplace|bus_station|social_facility|events_venue|courthouse)$"](${COUNTY_BBOX});
    nwr["name"]["shop"~"^(mall|department_store)$"](${COUNTY_BBOX});
    nwr["name"]["leisure"~"^(sports_centre|swimming_pool|stadium|fitness_centre|park|recreation_ground|nature_reserve|beach_resort)$"](${COUNTY_BBOX});
    nwr["name"]["tourism"~"^(museum|attraction|zoo|aquarium|gallery|theme_park)$"](${COUNTY_BBOX});
    nwr["name"]["railway"~"^(station|halt|tram_stop)$"](${COUNTY_BBOX});
    nwr["name"]["public_transport"="station"](${COUNTY_BBOX});
    nwr["name"]["natural"="beach"](${COUNTY_BBOX});
    nwr["name"]["place"~"^(neighbourhood|suburb|village|town|city|hamlet|locality|quarter)$"](${COUNTY_BBOX});
  ); out center tags;`],
];

type Row = [string, number, number, string, number];
const kindOf = (t: Record<string, string>): string =>
  t.amenity ?? t.leisure ?? t.tourism ?? t.shop ?? t.railway ?? t.public_transport ?? (t.building ? `building:${t.building}` : t.natural ?? t.office ?? t.healthcare ?? "place");

async function overpass(label: string, query: string): Promise<any[]> {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(OVERPASS, { method: "POST", headers: UA, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(200_000) });
      if (r.ok) return ((await r.json()) as { elements: any[] }).elements;
      console.log(`  ${label}: HTTP ${r.status}, retrying`);
    } catch (e) { console.log(`  ${label}: ${(e as Error).message.slice(0, 60)}, retrying`); }
    await new Promise((r) => setTimeout(r, 8000 * (a + 1)));
  }
  return [];
}

async function main() {
  const rows = new Map<string, Row>();
  const add = (name: string, lat: number, lon: number, kind: string, weight: number) => {
    name = name.replace(/\s+/g, " ").trim();
    if (name.length < 3 || !isFinite(lat) || !isFinite(lon)) return;
    const key = `${name.toLowerCase()}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    const old = rows.get(key);
    if (!old || old[4] < weight) rows.set(key, [name, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, kind, weight]);
  };

  for (const [label, q] of QUERIES) {
    const els = await overpass(label, q);
    let n = 0;
    for (const e of els) {
      const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon, t = e.tags ?? {};
      if (!t.name || lat == null) continue;
      // Buildings without a purpose are noise ("Parking Structure 12" is useful, "Building 4" is not).
      add(t.name, lat, lon, kindOf(t), label === "ucsd-la-jolla" ? 2 : 1); n++;
      if (t.alt_name) for (const alt of String(t.alt_name).split(";")) add(alt, lat, lon, kindOf(t), 2);
      if (t.short_name) add(t.short_name, lat, lon, kindOf(t), 2);
    }
    console.log(`${label}: ${els.length} OSM elements → ${n} named`);
  }

  // Our own sites and every Google Maps place we hold: these are the places callers are most likely to name.
  const seed = JSON.parse(await readFile(new URL("../data/seed/sites.json", import.meta.url), "utf8").catch(() => "[]"));
  for (const s of seed) add(s.name, s.lat, s.lon, `site:${s.kind}`, 5);
  const maps = JSON.parse(await readFile(new URL("./data/maps_sites.json", import.meta.url), "utf8").catch(() => "[]"));
  for (const m of maps) if (typeof m.lat === "number") add(m.name, m.lat, m.lon, `maps:${m.category ?? "place"}`, 4);

  const out = [...rows.values()].sort((a, b) => b[4] - a[4] || a[0].localeCompare(b[0]));
  await writeFile(new URL("../data/seed/landmarks.json", import.meta.url), JSON.stringify(out) + "\n");
  console.log(`\n${out.length} landmarks → data/seed/landmarks.json (${(JSON.stringify(out).length / 1e6).toFixed(2)} MB)`);
  const ucsd = out.filter((r) => r[1] > 32.835 && r[1] < 32.905 && r[2] > -117.3 && r[2] < -117.195);
  console.log(`${ucsd.length} in the UCSD / La Jolla box, e.g.:`, ucsd.filter((r) => /geisel|price center|rimac|center hall|mandeville|galbraith|student services|bookstore/i.test(r[0])).slice(0, 8).map((r) => r[0]).join(" | "));
}

main();

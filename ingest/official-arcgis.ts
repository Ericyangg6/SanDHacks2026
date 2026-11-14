// Step 1d: the county's OFFICIAL Cool Zones layer (ArcGIS feature service behind the county's interactive map).
// Structured, authoritative, with coordinates and site capacity. Fetched through Bright Data Web Unlocker.
//   node --env-file=.env ingest/official-arcgis.ts
// Found by following the links on the county Cool Zones page: app -> web map -> "2026 Cool Zones" layer.
import { writeFile } from "node:fs/promises";
import { fetchRaw, stats } from "./brightdata.ts";
import { record } from "./history.ts";

const LAYER = "https://services1.arcgis.com/1vIhDJwtG5eNmiqX/arcgis/rest/services/HLTH_COOL_ZONES_PUBLIC/FeatureServer/0";
const QUERY = `${LAYER}/query?where=1%3D1&outFields=*&outSR=4326&f=json&resultRecordCount=2000`;

async function main() {
  const r = await fetchRaw(QUERY);
  await record(QUERY, { ok: r.ok, status: r.status, markdown: r.body, error: r.error });
  if (!r.ok) throw new Error(`layer fetch failed: ${r.error ?? r.status}`);
  const j = JSON.parse(r.body);
  if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error).slice(0, 200)}`);

  const zones = j.features.map((f: any) => {
    const a = f.attributes;
    return {
      name: String(a.Organization ?? a.NAME ?? "").trim(),
      address: [a.Address, a.City, `${a.State ?? "CA"} ${a.ZipCode ?? ""}`].filter(Boolean).join(", ").replace(/\s+,/g, ","),
      street: a.Address, city: a.City, zip: a.ZipCode ? String(a.ZipCode) : null,
      lat: f.geometry?.y ?? null, lon: f.geometry?.x ?? null,
      phone: a.Phone ?? null,
      capacity: a.SiteCapacity ? Number(String(a.SiteCapacity).replace(/\D/g, "")) || null : null,
      pet_policy: a.PetPolicy || null,
      emergency_hours: a.EmergencyHours || null,
      link: a.LINK || null,
      objectid: a.OBJECTID,
    };
  }).filter((z: any) => z.name && z.lat != null);

  await writeFile(new URL("./data/official_cool_zones.json", import.meta.url), JSON.stringify(zones, null, 2));
  const cap = zones.filter((z: any) => z.capacity).length;
  console.log(`${zones.length} official Cool Zones → ingest/data/official_cool_zones.json | with capacity ${cap}, cities ${new Set(zones.map((z: any) => z.city)).size} (${stats().requests} API request)`);
}

main();

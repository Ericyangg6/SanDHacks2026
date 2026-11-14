// data/seed/places.json: ZIP centroids and town names -> coordinates, so find_sites can place a caller instantly
// (a live call must not wait on a geocoder). ZIPs come from the Census Gazetteer cache, towns from areas.ts.
//   node --env-file=.env ingest/places.ts
import { readFile, writeFile } from "node:fs/promises";
import { AREAS } from "./areas.ts";

async function main() {
  const zips = JSON.parse(await readFile(new URL("./cache/zcta.json", import.meta.url), "utf8")) as Record<string, { lat: number; lon: number }>;
  const places: Record<string, { lat: number; lon: number }> = {};
  for (const [name, [lat, lon]] of Object.entries(AREAS)) places[name.toLowerCase()] = { lat, lon };
  // common spoken variants
  const alias: Record<string, string> = { "san diego": "downtown", "sd": "downtown", "pb": "pacific beach", "ib": "imperial beach", "chula": "chula vista", "natl city": "national city" };
  for (const [a, t] of Object.entries(alias)) if (places[t]) places[a] = places[t];
  await writeFile(new URL("../data/seed/places.json", import.meta.url), JSON.stringify({ zips, places }, null, 1) + "\n");
  console.log(`${Object.keys(zips).length} ZIP centroids, ${Object.keys(places).length} place names → data/seed/places.json`);
}
main();

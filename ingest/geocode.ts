// Address -> lat/lon using the free US Census geocoder (no key). Results are cached on disk.
// Used for official-list sites that publish an address but no coordinates (schema requires lat/lon).
import { readFile, writeFile } from "node:fs/promises";

const FILE = new URL("./data/geocode_cache.json", import.meta.url);
let cache: Record<string, { lat: number; lon: number } | null> | null = null;

export async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
  if (!cache) cache = JSON.parse(await readFile(FILE, "utf8").catch(() => "{}"));
  const key = address.toLowerCase().replace(/\s+/g, " ").trim();
  if (key in cache!) return cache![key];

  // The geocoder only knows US addresses; add the region when the text lacks one.
  const q = /\bCA\b|California/i.test(address) ? address : `${address}, San Diego County, CA`;
  let out: { lat: number; lon: number } | null = null;
  try {
    const res = await fetch(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`,
      { signal: AbortSignal.timeout(20_000) },
    );
    const m = (await res.json())?.result?.addressMatches?.[0];
    if (m) out = { lat: m.coordinates.y, lon: m.coordinates.x };
  } catch {
    return null; // transient: don't cache a failure
  }
  cache![key] = out;
  await writeFile(FILE, JSON.stringify(cache, null, 1));
  return out;
}

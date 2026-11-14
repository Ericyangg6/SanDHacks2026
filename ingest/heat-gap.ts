// Step 7: the cooling-gap analysis. For every San Diego County ZIP: NWS heat forecast x Census vulnerability x our site coverage.
//   node --env-file=.env ingest/heat-gap.ts                 uses the live NWS forecast
//   node --env-file=.env ingest/heat-gap.ts --heat 105      "what if" scenario: peak heat index of 105 F everywhere
// Sources (all free, no key): NWS api.weather.gov (hourly forecast, forecast zone), US Census ACS 5-year (65+ residents,
// households without a vehicle), Census Gazetteer (ZIP centroids). Sites come from data/seed/sites.json.
// Writes data/seed/readings.json (contract `Reading[]`) and data/seed/zip_gap.json (ranked gaps).
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const UA = process.env.NWS_USER_AGENT ?? "shade-sandhacks-hackathon";
const SCENARIO = process.argv.includes("--heat") ? Number(process.argv[process.argv.indexOf("--heat") + 1]) : null;
const CACHE = new URL("./cache/", import.meta.url);
const SEED = new URL("../data/seed/", import.meta.url);

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const r = (d: number) => (d * Math.PI) / 180, R = 6371;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// NOAA's Rothfusz regression; below 80 F the simple formula applies.
function heatIndex(tF: number, rh: number): number {
  const simple = 0.5 * (tF + 61 + (tF - 68) * 1.2 + rh * 0.094);
  if ((simple + tF) / 2 < 80) return Math.round(simple);
  let hi = -42.379 + 2.04901523 * tF + 10.14333127 * rh - 0.22475541 * tF * rh - 0.00683783 * tF * tF - 0.05481717 * rh * rh
    + 0.00122874 * tF * tF * rh + 0.00085282 * tF * rh * rh - 0.00000199 * tF * tF * rh * rh;
  if (rh < 13 && tF >= 80 && tF <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(tF - 95)) / 17);
  if (rh > 85 && tF >= 80 && tF <= 87) hi += ((rh - 85) / 10) * ((87 - tF) / 5);
  return Math.round(hi);
}

// ---- 1. every San Diego County ZIP (ZCTA) with its centroid ----
async function zipCentroids(): Promise<Record<string, { lat: number; lon: number }>> {
  const file = new URL("./zcta.json", CACHE);
  try { return JSON.parse(await readFile(file, "utf8")); } catch {}
  await mkdir(CACHE, { recursive: true });
  const dir = new URL("./gaz/", CACHE).pathname;
  execFileSync("bash", ["-c", `mkdir -p ${dir} && curl -s -m 120 -o ${dir}z.zip https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip && unzip -o -q ${dir}z.zip -d ${dir}`]);
  const txt = await readFile(new URL("./gaz/2023_Gaz_zcta_national.txt", CACHE), "utf8");
  const out: Record<string, { lat: number; lon: number }> = {};
  for (const line of txt.split("\n").slice(1)) {
    const c = line.split("\t");
    const z = c[0]?.trim();
    // San Diego County: 919xx, 920xx (north county / inland), 921xx (city). 92 2xx+ is Imperial/Riverside.
    if (z && /^(919|920|921)\d\d$/.test(z)) out[z] = { lat: Number(c[5]), lon: Number(c[6]) };
  }
  await writeFile(file, JSON.stringify(out));
  return out;
}

// ---- 2. Census ACS (via Census Reporter, which serves the same ACS 5-year tables without an API key) ----
async function census(zips: string[]) {
  const out: Record<string, any> = {};
  const AGE65 = ["020", "021", "022", "023", "024", "025", "044", "045", "046", "047", "048", "049"];
  for (let i = 0; i < zips.length; i += 30) {
    const geo = zips.slice(i, i + 30).map((z) => `86000US${z}`).join(",");
    let d: any = null;
    for (let a = 0; a < 3 && !d; a++) {
      const r = await fetch(`https://api.censusreporter.org/1.0/data/show/latest?table_ids=B01001,B25044,B17001&geo_ids=${geo}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(90_000) }).catch(() => null);
      if (r?.ok) d = await r.json().catch(() => null);
      else await sleep(2000 * (a + 1));
    }
    if (!d) continue;
    for (const [geoid, t] of Object.entries<any>(d.data)) {
      const z = geoid.slice(-5);
      const e1 = t.B01001?.estimate ?? {}, e2 = t.B25044?.estimate ?? {}, e3 = t.B17001?.estimate ?? {};
      const v = (e: any, k: string) => Math.max(0, Number(e[k]) || 0);
      out[z] = {
        name: d.geography?.[geoid]?.name ?? z,
        population: v(e1, "B01001001"),
        age65plus: AGE65.reduce((s, n) => s + v(e1, `B01001${n}`), 0),
        households: v(e2, "B25044001"),
        households_no_vehicle: v(e2, "B25044003") + v(e2, "B25044010"),
        below_poverty: v(e3, "B17001002"),
        acs_release: d.release?.name ?? null,
      };
    }
  }
  return out;
}

// ---- 3. NWS hourly forecast per grid cell (many ZIPs share one) ----
const gridCache = new Map<string, any>();
async function nws(lat: number, lon: number) {
  const get = async (url: string) => {
    for (let a = 0; a < 3; a++) {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json" }, signal: AbortSignal.timeout(30_000) });
      if (r.ok) return r.json();
      await sleep(1500 * (a + 1));
    }
    return null;
  };
  const pt = await get(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  if (!pt) return null;
  const p = pt.properties, key = `${p.gridId}/${p.gridX},${p.gridY}`;
  if (!gridCache.has(key)) {
    const hourly = await get(p.forecastHourly);
    const periods = (hourly?.properties?.periods ?? []).slice(0, 72); // next 72 hours
    let peak: any = null, hot = 0;
    for (const x of periods) {
      const t = x.temperatureUnit === "C" ? x.temperature * 1.8 + 32 : x.temperature;
      const rh = x.relativeHumidity?.value ?? 40;
      const hi = heatIndex(t, rh);
      if (t >= 90) hot++;
      if (!peak || hi > peak.heat_index) peak = { time: x.startTime, temp_f: Math.round(t), heat_index: hi };
    }
    gridCache.set(key, { peak, hours_90f_plus: hot, hours: periods.length });
  }
  return { ...gridCache.get(key), forecast_zone: String(p.forecastZone).split("/").pop(), grid: key };
}

async function main() {
  const seed: any[] = JSON.parse(await readFile(new URL("sites.json", SEED), "utf8"));
  const centroids = await zipCentroids();
  const zips = Object.keys(centroids);
  console.log(`${zips.length} San Diego County ZIPs`);

  const acs = await census(zips);
  console.log(`Census: ${Object.keys(acs).length} ZIPs with demographics`);

  const populated = zips.filter((z) => (acs[z]?.population ?? 0) > 0);
  const weather: Record<string, any> = {};
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < populated.length) {
      const z = populated[next++];
      const w = await nws(centroids[z].lat, centroids[z].lon);
      if (w) weather[z] = w;
      await sleep(250);
    }
  }));
  console.log(`NWS: forecasts for ${Object.keys(weather).length} ZIPs from ${gridCache.size} forecast grid cells`);

  const rows = populated.map((z) => {
    const c = centroids[z], d = acs[z], w = weather[z];
    const near = seed.map((s) => ({ s, d: km(c, s) })).sort((a, b) => a.d - b.d);
    const within5 = near.filter((n) => n.d <= 5);
    const peakHI = SCENARIO ?? w?.peak?.heat_index ?? null;
    const heatFactor = peakHI == null ? 0.5 : Math.min(1.5, Math.max(0.2, (peakHI - 85) / 15)); // 85 F -> 0.2 floor, 107 F -> 1.5 cap
    const atRisk = d.age65plus + d.households_no_vehicle; // people least able to cope or to travel
    const open = within5.filter((n) => (n.s.hours?.weekly?.length ?? 0) > 0).length;
    return {
      zip: z, name: String(d.name ?? ""), lat: c.lat, lon: c.lon,
      population: d.population, age65plus: d.age65plus, households_no_vehicle: d.households_no_vehicle, below_poverty: d.below_poverty,
      residents_at_risk: atRisk,
      sites_within_5km: within5.length, official_within_5km: within5.filter((n) => n.s.tier === "official").length, sites_with_hours_5km: open,
      nearest_site_km: near[0] ? Number(near[0].d.toFixed(1)) : null, nearest_site: near[0]?.s.name ?? null,
      forecast_zone: w?.forecast_zone ?? null, peak_temp_f: w?.peak?.temp_f ?? null, peak_heat_index: peakHI, peak_time: w?.peak?.time ?? null,
      hours_90f_plus_72h: w?.hours_90f_plus ?? null,
      heat_factor: Number(heatFactor.toFixed(2)),
      // Transparent score: people at risk, scaled by heat, divided by nearby supply. Higher = worse served.
      gap_score: Math.round((atRisk * heatFactor) / (1 + within5.length)),
    };
  }).sort((a, b) => b.gap_score - a.gap_score);

  await mkdir(SEED, { recursive: true });
  await writeFile(new URL("zip_gap.json", SEED), JSON.stringify({
    generated_at: new Date().toISOString(),
    scenario_heat_index: SCENARIO,
    method: "gap_score = (65+ residents + households without a vehicle) x heat_factor / (1 + sites within 5 km). heat_factor from NWS 72h peak heat index (floor 0.2, cap 1.5).",
    sources: ["NWS api.weather.gov hourly forecast", "US Census ACS 5-year via Census Reporter (B01001, B25044, B17001)", "Census Gazetteer ZCTA centroids", "data/seed/sites.json"],
    zips: rows,
  }, null, 1));
  // Contract `Reading[]`: the forecast peak per ZIP.
  const readings = rows.filter((r) => r.peak_temp_f != null).map((r) => ({
    time: r.peak_time, zip: r.zip, temp_f: r.peak_temp_f, heat_index: weather[r.zip]?.peak?.heat_index ?? null, aqi: null, source: "nws",
  }));
  await writeFile(new URL("readings.json", SEED), JSON.stringify(readings, null, 1));

  const worst = rows.filter((r) => r.residents_at_risk > 500).slice(0, 12);
  console.log(`\nWorst-served ZIPs ${SCENARIO ? `(scenario: heat index ${SCENARIO} F)` : "(live NWS forecast)"}:`);
  console.log("zip    at-risk  sites≤5km  nearest   peak HI  score  area");
  for (const r of worst) console.log(`${r.zip}  ${String(r.residents_at_risk).padStart(6)}  ${String(r.sites_within_5km).padStart(8)}  ${String(r.nearest_site_km).padStart(6)} km  ${String(r.peak_heat_index ?? "-").padStart(6)}  ${String(r.gap_score).padStart(5)}  ${r.name.replace(/^ZCTA5 /, "")}`);
  const noSite = rows.filter((r) => r.sites_within_5km === 0 && r.residents_at_risk > 300);
  console.log(`\n${noSite.length} populated ZIPs have NO site within 5 km (${noSite.reduce((s, r) => s + r.residents_at_risk, 0).toLocaleString()} at-risk residents)`);
  console.log(`→ data/seed/zip_gap.json, data/seed/readings.json`);
}

main();

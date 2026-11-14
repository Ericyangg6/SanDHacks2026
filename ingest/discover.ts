// Step 1: SERP discovery. Bright Data's SERP API finds each place's own web pages (fast: seconds per query).
//   node --env-file=.env ingest/discover.ts              (every area x every query)
//   node --env-file=.env ingest/discover.ts "Julian"     (one area)
// Results ACCUMULATE in data/candidates.json, so runs only add. Every SERP response is cached.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { serp, stats, type SerpResult } from "./brightdata.ts";
import { AREAS } from "./areas.ts";

// kind -> query template. Each reaches a different kind of place that is open to the public and cool.
const QUERIES: Record<string, string> = {
  cool_zone: "{area} San Diego County Cool Zone cooling center hours",
  heat_relief: "{area} CA free air conditioned place to cool off during heat wave",
  library: "public library {area} CA hours",
  rec_center: "recreation center {area} CA hours",
  community_center: "community center {area} CA hours open to public",
  senior_center: "senior center {area} CA hours",
  ymca_club: "YMCA OR \"Boys & Girls Club\" {area} CA hours",
  pool: "public swimming pool aquatic center {area} CA open swim hours",
  mall: "shopping mall {area} CA hours",
};

// Results that are never a place you can walk into.
const SKIP = /(yelp|tripadvisor|facebook|instagram|youtube|reddit|wikipedia|indeed|zillow|mapquest|yellowpages|nextdoor|linkedin|tiktok|pinterest)\./i;

export type Candidate = {
  area: string; kind: string; title: string; url: string; domain: string; snippet: string; query: string;
};
const domainOf = (u: string) => new URL(u).hostname.replace(/^www\./, "");

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  // --gaps: search the ZIPs the cooling-gap analysis says are worst served (many at-risk residents, few nearby sites).
  let gapZips: string[] = [];
  if (process.argv.includes("--gaps")) {
    const z = JSON.parse(await readFile(new URL("../data/seed/zip_gap.json", import.meta.url), "utf8")).zips;
    gapZips = z.filter((r: any) => r.sites_within_5km <= 1 && r.residents_at_risk > 2000).map((r: any) => r.zip);
    console.log(`${gapZips.length} gap ZIPs: ${gapZips.join(", ")}`);
  }
  const areas = gapZips.length ? gapZips : only.length ? only : Object.keys(AREAS);
  const file = new URL("./data/candidates.json", import.meta.url);
  const byUrl = new Map<string, Candidate>();
  for (const c of JSON.parse(await readFile(file, "utf8").catch(() => "[]"))) byUrl.set(c.url, c);
  const before = byUrl.size;

  const jobs = areas.flatMap((area) => Object.entries(QUERIES).map(([kind, tmpl]) => ({ area, kind, query: tmpl.replace("{area}", area) })));
  console.log(`${areas.length} areas × ${Object.keys(QUERIES).length} queries = ${jobs.length} searches (cached ones are free)`);

  let next = 0, done = 0, failed = 0;
  async function worker() {
    while (next < jobs.length) {
      const j = jobs[next++];
      try {
        const results: SerpResult[] = await serp(j.query);
        for (const r of results) {
          if (!r.link.startsWith("http") || SKIP.test(r.link)) continue;
          const key = r.link.split("#")[0];
          if (!byUrl.has(key)) byUrl.set(key, { area: j.area, kind: j.kind, query: j.query, title: r.title, url: key, domain: domainOf(key), snippet: r.description });
        }
      } catch { failed++; }
      if (++done % 25 === 0) console.log(`  ${done}/${jobs.length} searches, ${byUrl.size - before} new URLs`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  await mkdir(new URL("./data/", import.meta.url), { recursive: true });
  await writeFile(file, JSON.stringify([...byUrl.values()], null, 2));
  console.log(`\n${byUrl.size} candidates (${byUrl.size - before} new, ${failed} failed searches) → ingest/data/candidates.json (${stats().requests} API requests)`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();

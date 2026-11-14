// Step 1: SERP discovery. Finds candidate public cooling sites per area.
//   node --env-file=.env ingest/discover.ts            (all demo areas)
//   node --env-file=.env ingest/discover.ts "El Cajon" (one area)
import { mkdir, writeFile } from "node:fs/promises";
import { serp, stats, type SerpResult } from "./brightdata.ts";

const AREAS = ["El Cajon", "La Jolla", "City Heights", "Chula Vista", "Oceanside"];

// kind -> query template. Add kinds here to widen discovery.
const QUERIES: Record<string, string> = {
  cool_zone: "{area} San Diego County Cool Zone cooling center hours",
  library: "public library {area} CA hours",
  rec_center: "recreation center {area} San Diego hours",
  community_center: "community center {area} CA hours open to public",
  senior_center: "senior center {area} San Diego hours",
};

// Results that are never a place you can walk into.
const SKIP = /(yelp|tripadvisor|facebook|instagram|youtube|reddit|wikipedia|indeed|zillow|mapquest|yellowpages|nextdoor)\./i;

export type Candidate = {
  area: string;
  kind: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  query: string;
};

const domainOf = (u: string) => new URL(u).hostname.replace(/^www\./, "");

async function main() {
  const only = process.argv[2];
  const areas = only ? [only] : AREAS;
  const byUrl = new Map<string, Candidate>();

  for (const area of areas) {
    for (const [kind, tmpl] of Object.entries(QUERIES)) {
      const query = tmpl.replace("{area}", area);
      let results: SerpResult[];
      try {
        results = await serp(query);
      } catch (e) {
        console.error(`✗ ${query}: ${(e as Error).message}`);
        continue;
      }
      let kept = 0;
      for (const r of results) {
        if (!r.link.startsWith("http") || SKIP.test(r.link)) continue;
        const key = r.link.split("#")[0];
        if (byUrl.has(key)) continue;
        byUrl.set(key, {
          area, kind, query,
          title: r.title, url: key, domain: domainOf(key), snippet: r.description,
        });
        kept++;
      }
      console.log(`✓ ${query} → ${kept} new`);
    }
  }

  const out = [...byUrl.values()];
  await mkdir(new URL("./data/", import.meta.url), { recursive: true });
  await writeFile(new URL("./data/candidates.json", import.meta.url), JSON.stringify(out, null, 2));
  console.log(`\n${out.length} candidates → ingest/data/candidates.json  (${stats().requests} API requests; cached ones are free)`);
}

main();

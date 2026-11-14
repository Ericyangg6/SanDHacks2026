// Step 2b: fetch each Google Maps site's OWN website (Bright Data; .gov falls back automatically),
// record a versioned snapshot, and save pages for extraction. Gives a second, independent source
// for hours + access rules so Maps records can be confirmed or contradicted.
//   node --env-file=.env ingest/fetch-maps-sites.ts [max] [--refresh]
import { readFile, writeFile } from "node:fs/promises";
import { fetchPage, stats } from "./brightdata.ts";
import { record } from "./history.ts";

const MAX = Number(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : 100);
const REFRESH = process.argv.includes("--refresh");
const SKIP = /(facebook|instagram|yelp|google|youtube|twitter|x\.com|linkedin|tiktok)\./i;

async function main() {
  const maps: any[] = JSON.parse(await readFile(new URL("./data/maps_sites.json", import.meta.url), "utf8"));
  const todo = maps.filter((s) => s.website && /^https?:/.test(s.website) && !SKIP.test(s.website)).slice(0, MAX);
  console.log(`${todo.length} of ${maps.length} Maps sites have a usable website`);

  const pages: any[] = [];
  const tally = { ok: 0, fallback: 0, failed: 0, cached: 0 };
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const s = todo[next++];
      try {
        const r = await fetchPage(s.website, { fresh: REFRESH });
        if (!r.from_cache) await record(s.website, r);
        if (!r.ok) { tally.failed++; console.log(`✗ ${s.name} → ${r.error ?? `status ${r.status}`}`.slice(0, 150)); continue; }
        r.from_cache ? tally.cached++ : r.via ? tally.fallback++ : tally.ok++;
        pages.push({
          url: s.website, domain: new URL(s.website).hostname.replace(/^www\./, ""), area: "maps",
          kind: s.category, title: s.name, source_type: "page", fetched_at: new Date().toISOString(),
          maps_place_id: s.place_id, maps_name: s.name, maps_address: s.address,
          markdown: r.markdown.slice(0, 20000),
        });
        console.log(`✓ ${s.name} (${r.markdown.length} chars${r.via ? ", fallback" : ""})`);
      } catch (e) {
        tally.failed++;
        console.error(`✗ ${s.name}: ${(e as Error).message.slice(0, 100)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Number(process.env.FETCH_CONCURRENCY ?? 4) }, worker));

  await writeFile(new URL("./data/pages_maps.json", import.meta.url), JSON.stringify(pages, null, 2));
  console.log(`\n${pages.length} pages → ingest/data/pages_maps.json | direct ${tally.ok}, fallback ${tally.fallback}, cached ${tally.cached}, failed ${tally.failed} (${stats().requests} API requests)`);
}

main();

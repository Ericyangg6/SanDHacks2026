// Step 2c: fetch each official Cool Zone's own page (the LINK in the county layer) so hours and access
// rules can be read from the site itself. Bright Data first; .gov domains use the automatic fallback.
//   node --env-file=.env ingest/fetch-official-links.ts [max] [--refresh]
import { readFile, writeFile } from "node:fs/promises";
import { fetchPage, stats } from "./brightdata.ts";
import { record } from "./history.ts";

const MAX = Number(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : 100);
const REFRESH = process.argv.includes("--refresh");

async function main() {
  const zones: any[] = JSON.parse(await readFile(new URL("./data/official_cool_zones.json", import.meta.url), "utf8"));
  const todo = zones.filter((z) => z.link && /^https?:/.test(z.link)).slice(0, MAX);
  console.log(`${todo.length} of ${zones.length} official zones have a page link`);

  const pages: any[] = [];
  const tally = { direct: 0, fallback: 0, cached: 0, failed: 0 };
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const z = todo[next++];
      try {
        const r = await fetchPage(z.link, { fresh: REFRESH });
        if (!r.from_cache) await record(z.link, r);
        if (!r.ok) { tally.failed++; console.log(`✗ ${z.name} → ${r.error ?? `status ${r.status}`}`.slice(0, 130)); continue; }
        r.from_cache ? tally.cached++ : r.via ? tally.fallback++ : tally.direct++;
        pages.push({
          url: z.link, domain: new URL(z.link).hostname.replace(/^www\./, ""), area: "official", kind: "cool_zone",
          title: z.name, source_type: "page", official: true, fetched_at: new Date().toISOString(),
          maps_name: z.name, maps_address: z.address, official_objectid: z.objectid,
          markdown: r.markdown.slice(0, 20000),
        });
      } catch (e) {
        tally.failed++;
        console.error(`✗ ${z.name}: ${(e as Error).message.slice(0, 100)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  await writeFile(new URL("./data/pages_official_links.json", import.meta.url), JSON.stringify(pages, null, 2));
  console.log(`${pages.length} pages → ingest/data/pages_official_links.json | direct ${tally.direct}, fallback ${tally.fallback}, cached ${tally.cached}, failed ${tally.failed} (${stats().requests} API requests)`);
}

main();

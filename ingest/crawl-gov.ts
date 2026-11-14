// Step 1e: discover and fetch location pages on every San Diego County city/county site.
// Government domains are refused by Bright Data, so this step uses the fallback fetcher; pages enter the same
// versioned history, the same extraction and the same verbatim-quote gate as everything else.
//   node --env-file=.env ingest/crawl-gov.ts [maxPagesPerDomain=60]
import { writeFile } from "node:fs/promises";
import { fallbackCredits, mapSite, scrapeMain } from "./brightdata.ts";
import { record } from "./history.ts";

const PER_DOMAIN = Number(process.argv[2] ?? 60);
const DOMAINS = [
  "sandiego.gov", "sandiegocounty.gov", "chulavistaca.gov", "oceansideca.org", "escondido.gov", "elcajon.gov",
  "nationalcityca.gov", "cityoflamesa.us", "cityofsanteeca.gov", "vista.gov", "carlsbadca.gov", "encinitasca.gov",
  "poway.gov", "lemongrove.ca.gov", "imperialbeachca.gov", "sanmarcosca.gov", "coronado.ca.us", "delmar.ca.us",
  "solanabeach.gov", "citybrgh.com",
];
const KEEP = /librar|recreation|rec-center|rec-centre|senior|community-?cent|cool-?zone|cooling|aquatic|swim|pool|splash|park-and-rec|parks-and-rec|heat/i;
const DROP = /news|agenda|minutes|event|calendar|job|career|permit|bid|rfp|\.pdf|\.jpg|\/archive|login|search\?|tag\/|category\/|\/about$|history/i;

async function main() {
  const pages: any[] = [];
  const seen = new Set<string>();
  for (const domain of DOMAINS) {
    let urls: string[] = [];
    try {
      urls = await mapSite(domain, { search: "library recreation center senior center community center cooling", maxLinks: 400 });
    } catch (e) {
      console.log(`✗ ${domain}: ${(e as Error).message.slice(0, 80)}`);
      continue;
    }
    const picked = [...new Set(urls.map((u) => u.split("#")[0].split("?")[0]))]
      .filter((u) => KEEP.test(u) && !DROP.test(u) && !seen.has(u))
      .slice(0, PER_DOMAIN);
    picked.forEach((u) => seen.add(u));
    console.log(`${domain}: ${urls.length} urls mapped → ${picked.length} location-like pages`);

    let next = 0, got = 0;
    async function worker() {
      while (next < picked.length) {
        const url = picked[next++];
        try {
          const md = await scrapeMain(url);
          await record(url, { ok: !!md, status: md ? 200 : 0, markdown: md ?? "", error: md ? undefined : "no main content" });
          if (!md) continue;
          got++;
          pages.push({ url, domain, area: "official", kind: "other", title: url.split("/").filter(Boolean).pop(), source_type: "page",
            official: true, fetched_at: new Date().toISOString(), markdown: md.slice(0, 20000) });
        } catch (e) {
          console.log(`  ✗ ${url.slice(-60)}: ${(e as Error).message.slice(0, 70)}`);
        }
      }
    }
    await Promise.all(Array.from({ length: 3 }, worker));
    console.log(`  fetched ${got}/${picked.length} | fallback credits left: ${fallbackCredits()}`);
  }
  await writeFile(new URL("./data/pages_gov.json", import.meta.url), JSON.stringify(pages, null, 2));
  console.log(`\n${pages.length} pages → ingest/data/pages_gov.json | fallback credits left: ${fallbackCredits()}`);
}

main();

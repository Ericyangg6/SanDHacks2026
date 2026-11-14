// Step 1c: find and fetch OFFICIAL cooling-center sources (county, cities, 211, county library).
// This fills the "official" tier: places listed by a government or the county's 211 service.
//   node --env-file=.env ingest/official.ts [maxPages]
// Bright Data SERP finds the pages; pages are fetched with fetchPage (Bright Data first; .gov
// domains, which Bright Data refuses by policy, go through the automatic fallback).
import { writeFile } from "node:fs/promises";
import { fetchPage, serp, stats } from "./brightdata.ts";
import { record } from "./history.ts";

const MAX = Number(process.argv[2] ?? 40);

const CITIES = [
  "El Cajon", "Escondido", "Chula Vista", "Oceanside", "National City", "La Mesa", "Santee", "Vista",
  "Carlsbad", "Encinitas", "Poway", "Lemon Grove", "Imperial Beach", "San Marcos", "San Diego",
];
const PLACE = process.env.PLACE; // on-demand search: add queries for one place
const QUERIES = [
  ...(PLACE ? [`${PLACE} CA cooling center heat relief hours`, `${PLACE} CA cool zone library community center`, `City of ${PLACE} extreme heat resources`] : []),
  "San Diego County Cool Zones list of locations hours",
  "County of San Diego Cool Zones map directory",
  "211 San Diego cooling centers cool zones",
  "San Diego County cooling centers extreme heat open locations",
  ...CITIES.map((c) => `City of ${c} cooling center heat relief locations hours`),
];

// What counts as an official source. Anything else is "discovered", never "official".
export const OFFICIAL_HOST = /(^|\.)(\w+\.)?gov$|(^|\.)211sandiego\.org$|(^|\.)sdcl\.org$/i;
// San Diego County governments. Other .gov hosts must mention San Diego County in the page itself.
const SD_HOST = /(sandiego(county)?\.gov|elcajon\.gov|escondido\.(org|gov)|chulavistaca\.gov|oceansideca\.org|nationalcityca\.gov|cityoflamesa\.(us|com)|cityofsanteeca\.gov|vista\.gov|carlsbadca\.gov|encinitasca\.gov|poway\.(org|gov)|lemongrove\.ca\.gov|imperialbeachca\.gov|sanmarcosca\.gov|211sandiego\.org|sdcl\.org|sdmts\.com)$/i;
const inCounty = (h: string, md: string) => SD_HOST.test(h) || /san diego county/i.test(md);
const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");

async function main() {
  const found = new Map<string, { url: string; title: string; query: string }>();
  for (const q of QUERIES) {
    try {
      for (const r of await serp(q)) {
        let h: string;
        try { h = host(r.link); } catch { continue; }
        if (!OFFICIAL_HOST.test(h)) continue;
        if (/^(ready\.lacounty|longbeach|phoenix|mesaaz|albanyca|fontanaca|sanmarcostx)/i.test(h)) continue; // other regions
        const url = r.link.split("#")[0];
        if (!found.has(url)) found.set(url, { url, title: r.title, query: q });
      }
    } catch (e) {
      console.error(`✗ ${q}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  const urls = [...found.values()].slice(0, MAX);
  console.log(`${found.size} official-source URLs found by ${QUERIES.length} searches; fetching ${urls.length}`);

  const pages: any[] = [];
  const tally = { direct: 0, fallback: 0, cached: 0, failed: 0 };
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const u = urls[next++];
      try {
        const r = await fetchPage(u.url);
        if (!r.from_cache) await record(u.url, r);
        if (!r.ok) { tally.failed++; console.log(`✗ ${host(u.url)} → ${r.error ?? `status ${r.status}`}`.slice(0, 140)); continue; }
        if (!inCounty(host(u.url), r.markdown)) { console.log(`– skip ${host(u.url)} (not San Diego County)`); continue; }
        r.from_cache ? tally.cached++ : r.via ? tally.fallback++ : tally.direct++;
        pages.push({
          url: u.url, domain: host(u.url), area: "official", kind: "cool_zone", title: u.title,
          source_type: "page", official: true, fetched_at: new Date().toISOString(),
          markdown: r.markdown.slice(0, 60000),
        });
        console.log(`✓ ${host(u.url)} ${u.url.slice(-40)} (${r.markdown.length} chars${r.via ? ", fallback" : ""})`);
      } catch (e) {
        tally.failed++;
        console.error(`✗ ${u.url}: ${(e as Error).message.slice(0, 100)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  // Official pages often link the real list as a PDF (the county publishes its Cool Zone Site List this way).
  const pdfs = new Set<string>();
  for (const pg of pages)
    for (const m of pg.markdown.matchAll(/\]\((https?:\/\/[^)\s]+\.pdf)\)/gi))
      if (/cool.?zone|cooling|heat/i.test(m[1])) pdfs.add(m[1]);
  for (const url of [...pdfs].slice(0, 5)) {
    const r = await fetchPage(url);
    if (!r.from_cache) await record(url, r);
    if (!r.ok) { console.log(`✗ PDF ${url.slice(-50)} → ${r.error ?? r.status}`.slice(0, 140)); continue; }
    pages.push({ url, domain: host(url), area: "official", kind: "cool_zone", title: "Official Cool Zone site list (PDF)",
      source_type: "page", official: true, fetched_at: new Date().toISOString(), markdown: r.markdown });
    console.log(`✓ PDF ${host(url)}/…${url.slice(-34)} (${r.markdown.length} chars${r.via ? ", fallback" : ""})`);
  }

  await writeFile(new URL("./data/pages_official.json", import.meta.url), JSON.stringify(pages, null, 2));
  console.log(`\n${pages.length} official pages → ingest/data/pages_official.json | direct ${tally.direct}, fallback ${tally.fallback}, cached ${tally.cached}, failed ${tally.failed} (${stats().requests} API requests)`);
}

main();

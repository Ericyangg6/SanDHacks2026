// Step 1f: news and notices via Bright Data SERP (Google News). Finds program changes, extended hours, pop-up
// cooling centers and closures, which no static list carries. Articles are fetched and read like any other page.
//   node --env-file=.env ingest/news.ts [freshness=m]     m = past month, w = week, y = year
import { writeFile } from "node:fs/promises";
import { fetchPage, serpNews, stats } from "./brightdata.ts";
import { record } from "./history.ts";

const FRESH = process.argv[2] ?? "m";
const CITIES = ["San Diego", "El Cajon", "Chula Vista", "Escondido", "Oceanside", "National City", "La Mesa", "Santee", "Vista", "Carlsbad", "Lakeside", "Spring Valley"];
const QUERIES = [
  "San Diego County Cool Zones cooling centers open extended hours",
  "San Diego County extreme heat cooling center pop-up open",
  "San Diego library closed holiday hours",
  "San Diego heat advisory cooling centers locations",
  ...CITIES.map((c) => `${c} CA cooling center heat relief`),
];

async function main() {
  const items = new Map<string, { title: string; link: string; source: string; date: string; query: string }>();
  for (const q of QUERIES) {
    try { for (const r of await serpNews(q, FRESH)) if (!items.has(r.link)) items.set(r.link, { ...r, query: q }); }
    catch (e) { console.log(`✗ ${q}: ${(e as Error).message.slice(0, 80)}`); }
  }
  // Keep headlines that are actually about cooling / heat relief / hours.
  const RELEVANT = /cool zone|cooling|heat|hours|closed|closure|open|relief|air.?condition/i;
  const list = [...items.values()].filter((i) => RELEVANT.test(i.title));
  console.log(`${items.size} news items, ${list.length} relevant (freshness: ${FRESH})`);

  const pages: any[] = [];
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const n = list[next++];
      try {
        const r = await fetchPage(n.link);
        if (!r.from_cache) await record(n.link, r);
        if (!r.ok) continue;
        pages.push({ url: n.link, domain: new URL(n.link).hostname.replace(/^www\./, ""), area: "news", kind: "other", title: n.title,
          source_type: "page", fetched_at: new Date().toISOString(), published: n.date, markdown: r.markdown.slice(0, 20000) });
      } catch { /* skip */ }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  await writeFile(new URL("./data/pages_news.json", import.meta.url), JSON.stringify(pages, null, 2));
  await writeFile(new URL("../data/seed/news.json", import.meta.url), JSON.stringify(
    list.map(({ title, link, source, date }) => ({ title, link, source, date })), null, 1) + "\n");
  console.log(`${pages.length} articles fetched → ingest/data/pages_news.json | headlines → data/seed/news.json (${stats().requests} API requests)`);
  for (const n of list.slice(0, 12)) console.log(`  ${n.date.padEnd(12)} ${n.source.slice(0, 22).padEnd(22)} ${n.title.slice(0, 80)}`);
}

main();

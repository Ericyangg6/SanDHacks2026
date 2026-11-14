// UCSD and La Jolla deep search: libraries, student centers, study spaces, cafes, malls, community centers and
// anything else on or near campus where someone can sit indoors out of the heat.
//   MAPS_LIMIT_PER_INPUT=20 node --env-file=.env ingest/campus.ts [--no-maps]
// Two sources, both Bright Data:
//   1. SERP: many targeted web searches, each topic labelled separately so its pages are all fetched (ucsd.edu has many)
//   2. Google Maps scraper: a grid of points over campus and the surrounding area x place-type keywords
// Results accumulate in candidates.json and maps_sites.json; run fetch-pages / fetch-maps-sites / extract / merge afterwards.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ingestRows, snapshot } from "./maps.ts";
import { serp, stats } from "./brightdata.ts";

// [label, lat, lon]: centers of the places people actually are on and around campus.
const POINTS: [string, number, number][] = [
  ["UCSD Geisel Library / central campus", 32.8811, -117.2376],
  ["UCSD Price Center", 32.8795, -117.2362],
  ["UCSD Revelle and Muir", 32.8765, -117.2415],
  ["UCSD Warren and Marshall", 32.8825, -117.2340],
  ["UCSD north campus (Sixth, Eighth)", 32.8885, -117.2425],
  ["UCSD East Campus and Health Sciences", 32.8780, -117.2250],
  ["Scripps Institution of Oceanography", 32.8657, -117.2540],
  ["La Jolla Village", 32.8470, -117.2740],
  ["La Jolla Shores", 32.8570, -117.2590],
  ["UTC Westfield and Costa Verde", 32.8710, -117.2130],
  ["Regents Road and Nobel Drive", 32.8690, -117.2200],
];
const KEYWORDS = ["library", "student center", "coffee shop cafe", "study space", "community center", "recreation center gym", "shopping mall", "church hall", "museum", "bookstore"];

const SERP_TOPICS: [string, string][] = [
  ["geisel", "UCSD Geisel Library hours public access"], ["biomed", "UCSD Biomedical Library hours"], ["sciengr", "UCSD Science and Engineering Library hours"],
  ["sshl", "UCSD Social Sciences and Humanities Library hours"], ["library-public", "UC San Diego library visitors community borrower public access"],
  ["price", "UCSD Price Center hours open"], ["loft", "UCSD The Loft Price Center hours"], ["student-center", "UCSD student center air conditioned study space open late"],
  ["study", "UCSD study spaces open late hours campus"], ["dining", "UCSD dining halls hours open to public visitors"], ["parkmarket", "UCSD Park Market hours"],
  ["rimac", "UCSD RIMAC recreation hours guest public"], ["canyonview", "UCSD Canyonview aquatic center hours public"], ["faculty-club", "UCSD Faculty Club hours"],
  ["cooling", "UCSD heat cooling center campus extreme heat resources"], ["basic-needs", "UCSD Basic Needs Hub hours"], ["health", "UCSD Student Health Services hours"],
  ["birch", "Birch Aquarium hours admission"], ["scripps", "Scripps Institution of Oceanography visitor center hours"], ["mcasd", "Museum of Contemporary Art San Diego La Jolla hours"],
  ["riford", "La Jolla Riford Library hours"], ["ljrec", "La Jolla Recreation Center hours"], ["ljcommunity", "La Jolla community center senior hours open to public"],
  ["shores", "La Jolla Shores park pavilion hours"], ["utc", "Westfield UTC mall hours"], ["torrey", "Torrey Pines State Natural Reserve visitor center hours"],
  ["lj-cooling", "La Jolla cooling center heat wave free air conditioned"], ["lj-cafe", "La Jolla Village coffee shop study seating air conditioned"],
  ["lj-church", "La Jolla church hall community room open to public hours"], ["ymca", "La Jolla YMCA Ecke family hours guest"], ["vlj", "Village at La Jolla library UCSD nearby community"],
  ["transit", "UCSD La Jolla transit center bus hours shelter"], ["mtstrolley", "UCSD Blue Line trolley station La Jolla heat"],
];

async function main() {
  const file = new URL("./data/candidates.json", import.meta.url);
  const byUrl = new Map<string, any>();
  for (const c of JSON.parse(await readFile(file, "utf8").catch(() => "[]"))) byUrl.set(c.url, c);
  const before = byUrl.size;

  // 1. SERP (fast)
  let next = 0, failed = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < SERP_TOPICS.length) {
      const [topic, query] = SERP_TOPICS[next++];
      try {
        for (const r of await serp(query)) {
          if (!r.link.startsWith("http") || /(yelp|tripadvisor|facebook|instagram|youtube|reddit|wikipedia|linkedin|tiktok|pinterest|nextdoor)\./i.test(r.link)) continue;
          const url = r.link.split("#")[0];
          if (!byUrl.has(url)) byUrl.set(url, { area: `UCSD ${topic}`, kind: "other", query, title: r.title, url, domain: new URL(url).hostname.replace(/^www\./, ""), snippet: r.description });
        }
      } catch { failed++; }
    }
  }));
  await mkdir(new URL("./data/", import.meta.url), { recursive: true });
  await writeFile(file, JSON.stringify([...byUrl.values()], null, 2));
  console.log(`SERP: ${SERP_TOPICS.length} searches (${failed} failed) → ${byUrl.size - before} new candidate pages (${stats().requests} requests)`);

  // 2. Google Maps (slow: runs in chunks and saves each as it finishes)
  if (process.argv.includes("--no-maps")) return;
  const inputs = POINTS.flatMap(([, lat, long]) => KEYWORDS.map((keyword) => ({ country: "US", lat, long, zoom_level: 15, keyword })));
  console.log(`Maps: ${inputs.length} searches over ${POINTS.length} points`);
  for (let i = 0; i < inputs.length; i += 40) {
    try { await ingestRows(await snapshot(inputs.slice(i, i + 40))); console.log(`  chunk ${i / 40 + 1}/${Math.ceil(inputs.length / 40)} saved`); }
    catch (e) { console.log(`  chunk ${i / 40 + 1} failed: ${(e as Error).message.slice(0, 90)} (recover with maps-recover.ts)`); }
  }
}

main();

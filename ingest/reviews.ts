// Step 3b: air-conditioning and crowding signals from Google Maps reviews (Bright Data reviews scraper).
//   node --env-file=.env ingest/reviews.ts [maxSites=6] [daysLimit=365]
// Nothing else on the web says whether a library is actually cool or packed. Reviews do.
// Signals are deterministic regex matches on the review text, and every signal keeps a verbatim
// excerpt, so claims can be checked against the review itself. NO model is involved.
//
// COST: the scraper returns every review in the window, so cost scales with review volume.
// Start small (default 6 sites) and look at "records per site" before raising maxSites.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
if (!TOKEN) throw new Error("Set BRIGHTDATA_API_TOKEN in .env");
const DATASET = "gd_luzfs1dn2oa0teb81"; // "Google maps reviews"
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const MAX_SITES = Number(process.argv[2] ?? 6);
const DAYS = Number(process.argv[3] ?? 365);

const AC_POS = /\b(nice and (cool|cold)|cool inside|cold inside|air[- ]?condition(ed|ing)? (is |was )?(great|nice|good|working|works|cold|on)|well air[- ]?conditioned|a\/c (is |was )?(great|nice|good|working|works|cold|on)|cool(ed)? (and|&) comfortable|great a\/c|good a\/c|nice a\/c|great ac|good ac|nice ac|blasting (the )?a(c|\/c)|freezing (cold )?in(side)?)\b/i;
const AC_NEG = /\b(no (air[- ]?conditioning|a\/c|\bac\b)|(air[- ]?conditioning|a\/c|\bac\b) (is |was |has been )?(broken|not working|off|out|down|doesn'?t work|wasn'?t working|isn'?t working)|too hot|hot inside|sweltering|stuffy|no cooling|boiling)\b/i;
const CROWDED = /\b(packed|crowded|overcrowded|no (seats|seating|room|space)|standing room|so busy|very busy|always full)\b/i;
const SPACIOUS = /\b(quiet|plenty of (seats|seating|space|room|tables)|spacious|empty|never crowded|lots of seating)\b/i;

const excerpt = (text: string, m: RegExpMatchArray) => {
  const i = m.index ?? 0;
  return text.slice(Math.max(0, i - 70), Math.min(text.length, i + m[0].length + 90)).replace(/\s+/g, " ").trim();
};

async function snapshot(input: any[]): Promise<any[]> {
  const res = await fetch(`https://api.brightdata.com/datasets/v3/trigger?dataset_id=${DATASET}&include_errors=true`, {
    method: "POST", headers: H, body: JSON.stringify(input),
  });
  const trig = await res.json();
  if (!res.ok || !trig.snapshot_id) throw new Error(`trigger failed: ${JSON.stringify(trig).slice(0, 300)}`);
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const p = await (await fetch(`https://api.brightdata.com/datasets/v3/progress/${trig.snapshot_id}`, { headers: H })).json();
    if (p.status === "ready") break;
    if (p.status === "failed") throw new Error("snapshot failed");
  }
  return (await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${trig.snapshot_id}?format=json`, { headers: H })).json();
}

async function main() {
  const maps: any[] = JSON.parse(await readFile(new URL("./data/maps_sites.json", import.meta.url), "utf8"));
  // Sites worth the spend: have hours, are cooling-relevant, and have enough reviews to say something.
  const sigFile = new URL("./data/review_signals.json", import.meta.url);
  const done: Record<string, any> = JSON.parse(await readFile(sigFile, "utf8").catch(() => "{}"));
  const targets = maps
    .filter((s) => s.hours?.length && (s.reviews_count ?? 0) >= 15 && !done[s.place_id])
    .sort((a, b) => (a.reviews_count ?? 0) - (b.reviews_count ?? 0)) // cheapest first: fewer reviews = fewer billed records
    .slice(0, MAX_SITES);
  console.log(`${targets.length} sites (reviews per site: ${targets.map((t) => t.reviews_count).join(", ")}), last ${DAYS} days`);
  if (!targets.length) return;

  const rows = await snapshot(targets.map((t) => ({ url: t.source_url, days_limit: DAYS, sort_by: "Most relevant" })));
  console.log(`${rows.length} review records for ${targets.length} sites (${(rows.length / targets.length).toFixed(0)} per site)`);

  const byPlace = new Map<string, any[]>();
  for (const r of rows) if (r.place_id && r.review) (byPlace.get(r.place_id) ?? byPlace.set(r.place_id, []).get(r.place_id)!).push(r);

  for (const t of targets) {
    const rs = byPlace.get(t.place_id) ?? [];
    const sig = { place_id: t.place_id, name: t.name, reviews_scanned: rs.length, window_days: DAYS,
      ac_positive: 0, ac_negative: 0, crowded: 0, spacious: 0, quotes: [] as any[], scanned_at: new Date().toISOString() };
    for (const r of rs) {
      const text: string = r.review;
      for (const [kind, re, key] of [["ac_positive", AC_POS, "ac_positive"], ["ac_negative", AC_NEG, "ac_negative"],
        ["crowded", CROWDED, "crowded"], ["spacious", SPACIOUS, "spacious"]] as const) {
        const m = text.match(re);
        if (!m) continue;
        (sig as any)[key]++;
        if (sig.quotes.length < 8) sig.quotes.push({ signal: kind, quote: excerpt(text, m), review_date: r.review_date ?? null, rating: r.review_rating ?? null });
      }
    }
    done[t.place_id] = sig;
    console.log(`  ${t.name}: ${rs.length} reviews → AC+ ${sig.ac_positive}, AC− ${sig.ac_negative}, crowded ${sig.crowded}, spacious ${sig.spacious}`);
  }
  await mkdir(new URL("./data/", import.meta.url), { recursive: true });
  await writeFile(sigFile, JSON.stringify(done, null, 2));
  console.log(`→ ingest/data/review_signals.json (${Object.keys(done).length} sites total)`);
}

main();

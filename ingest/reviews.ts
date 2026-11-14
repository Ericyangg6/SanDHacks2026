// Step 3b: air-conditioning and crowding signals from Google Maps reviews (Bright Data reviews scraper).
//   node --env-file=.env ingest/reviews.ts [maxSites=6] [daysLimit=365]
// Nothing else on the web says whether a library is actually cool or packed. Reviews do.
// Signals are deterministic regex matches on the review text, and every signal keeps a verbatim
// excerpt, so claims can be checked against the review itself. NO model is involved.
//
// COST: about 1 credit per site (up to REVIEWS_PER_SITE newest reviews, default 100).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fallbackCredits, mapsReviews } from "./brightdata.ts";

const MAX_SITES = Number(process.argv[2] ?? 400);
const DAYS = Number(process.argv[3] ?? 365);
const LIMIT = Number(process.env.REVIEWS_PER_SITE ?? 100);

// Precision over recall: a false claim about a place is worse than a missed one. Every pattern needs an indoor or AC
// context ("inside", "in here", "A/C"...). Bare words like "stuffy" or "too hot" are NOT enough ("stuffy mall" can be
// praise, "too hot outside" is about the weather).
const AC = String.raw`(?:a\/c|a\.c\.|\bac\b|air[- ]?condition(?:ed|ing|er)?|air con\b|climate control|cooling)`;
const INSIDE = String.raw`(?:inside|in here|in there|in the (?:building|library|center|centre|mall|museum|store|gym|room))`;
const AC_POS = new RegExp(
  String.raw`\b(?:(?:nice(?:ly)?|so|very|really|pleasantly|super|perfectly)\s+(?:and\s+)?(?:cool|cold|chilly|air[- ]?conditioned)\s+${INSIDE}|(?:cool|cold|chilly|air[- ]?conditioned|comfortable)\s+${INSIDE}|well[- ]air[- ]?conditioned|${AC}\s+(?:is|was|works|worked|working)?\s*(?:great|good|nice|excellent|wonderful|cold|on|working|works)|(?:great|good|nice|excellent|strong|cold)\s+${AC}|cool(?:ed)? off inside|escape the heat)\b`, "i");
const AC_NEG = new RegExp(
  String.raw`\b(?:no\s+${AC}|without\s+${AC}|${AC}\s+(?:is|was|has been|wasn't|isn't|doesn't|didn't|does not|did not)?\s*(?:broken|out|off|down|not working|not work|don't work|doesn't work|wasn't working|isn't working|non-?existent|not on)|(?:broken|no|without|non-?existent)\s+(?:${AC}|climate control)|(?:hot|warm|sweltering|boiling|stuffy|muggy|uncomfortable)\s+${INSIDE}|${INSIDE}\s+(?:was|is|felt|feels)\s+(?:so\s+|very\s+|really\s+)?(?:hot|warm|sweltering|boiling|stuffy|muggy)|too (?:hot|warm)\s+${INSIDE})\b`, "i");
const CROWDED = /\b(?:packed|crowded|overcrowded|no (?:seats|seating|room|space|available seats)|standing room|so busy|very busy|always full|full house)\b/i;
const SPACIOUS = /\b(?:plenty of (?:seats|seating|space|room|tables|parking)|spacious|never crowded|lots of seating|quiet and (?:calm|peaceful)|not crowded|empty)\b/i;

const excerpt = (text: string, m: RegExpMatchArray) => {
  const i = m.index ?? 0;
  return text.slice(Math.max(0, i - 70), Math.min(text.length, i + m[0].length + 90)).replace(/\s+/g, " ").trim();
};

async function main() {
  const maps: any[] = JSON.parse(await readFile(new URL("./data/maps_sites.json", import.meta.url), "utf8"));
  const sigFile = new URL("./data/review_signals.json", import.meta.url);
  const done: Record<string, any> = JSON.parse(await readFile(sigFile, "utf8").catch(() => "{}"));
  // Every Maps site we hold hours for, most-reviewed first (those have the most to say).
  const targets = maps.filter((s) => s.hours?.length && s.source_url && !done[s.place_id])
    .sort((a, b) => (b.reviews_count ?? 0) - (a.reviews_count ?? 0)).slice(0, MAX_SITES);
  console.log(`${targets.length} sites, up to ${LIMIT} newest reviews each, last ${DAYS} days`);

  const since = Date.now() - DAYS * 86400_000;
  let next = 0, withReviews = 0, failed = 0;
  async function worker() {
    while (next < targets.length) {
      const t = targets[next++];
      try {
        const rs = (await mapsReviews(t.source_url, LIMIT)).filter((r) => !r.isoDate || Date.parse(r.isoDate) >= since);
        const sig = { place_id: t.place_id, name: t.name, reviews_scanned: rs.length, window_days: DAYS,
          ac_positive: 0, ac_negative: 0, crowded: 0, spacious: 0, quotes: [] as any[], scanned_at: new Date().toISOString() };
        for (const r of rs) {
          for (const [kind, re] of [["ac_positive", AC_POS], ["ac_negative", AC_NEG], ["crowded", CROWDED], ["spacious", SPACIOUS]] as const) {
            const m = r.text.match(re);
            if (!m) continue;
            (sig as any)[kind]++;
            if (sig.quotes.length < 8) sig.quotes.push({ signal: kind, quote: excerpt(r.text, m), review_date: r.isoDate, rating: r.rating });
          }
        }
        done[t.place_id] = sig;
        if (rs.length) withReviews++;
        const hit = sig.ac_positive + sig.ac_negative + sig.crowded + sig.spacious;
        if (hit) console.log(`  ${t.name}: ${rs.length} reviews → AC+ ${sig.ac_positive}, AC− ${sig.ac_negative}, crowded ${sig.crowded}, spacious ${sig.spacious}`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${t.name}: ${(e as Error).message.slice(0, 80)}`);
      }
      if ((next % 25) === 0) await writeFile(sigFile, JSON.stringify(done, null, 2)); // save as we go
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  await mkdir(new URL("./data/", import.meta.url), { recursive: true });
  await writeFile(sigFile, JSON.stringify(done, null, 2));
  const sigs = Object.values(done) as any[];
  console.log(`\n${withReviews} sites had reviews, ${failed} failed → ingest/data/review_signals.json`);
  console.log(`signals: AC+ at ${sigs.filter((s) => s.ac_positive).length} sites, AC− at ${sigs.filter((s) => s.ac_negative).length}, crowded at ${sigs.filter((s) => s.crowded).length}, spacious at ${sigs.filter((s) => s.spacious).length} | credits left: ${fallbackCredits()}`);
}

main();

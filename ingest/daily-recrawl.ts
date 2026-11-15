// Daily re-crawl: re-fetch the own page of every site we hold, through Bright Data, compare with the last snapshot,
// and publish a "what changed" feed (hours changed, new closure). Pages that did not change cost nothing downstream.
//   node --env-file=.env ingest/daily-recrawl.ts                 re-crawl, write data/seed/changes_feed.json
//   node --env-file=.env ingest/daily-recrawl.ts --push          also insert the new feed rows into Neon site_changes
//   node --env-file=.env ingest/daily-recrawl.ts --max 50        credit guard (default: every page)
// Scheduled by .github/workflows/daily-recrawl.yml. The feed is served by GET /m2/changes.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { fetchPage } from "./brightdata.ts";
import { record, type Change } from "./history.ts";

export type FeedEntry = {
  id: string; detected_at: string; kind: "hours_changed" | "new_closure"; url: string;
  site_ids: number[]; site_names: string[]; summary: string; before: string[]; after: string[];
};

const TIME = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b(?:noon|midnight)\b/gi;
const CLOSURE = /\b(closed|closure|closing|cancell?ed|will not be open)\b/i;
const WHEN = /\b(today|tomorrow|this (?:week|weekend)|temporarily|until further notice|effective|due to|holiday|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2})\b/i;
// A line counts as opening hours only if it has a time AND a weekday / "open" / "hours" word, and is not an event listing.
const HOURSY = /\b(hours|open|opens|mon|tue|wed|thu|fri|sat|sun|daily|weekdays?)[a-z]*\b/i;
const EVENT = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*[|,@-]|\b(?:register|registration|class|workshop|storytime|program|event|notice)\b/i;
const hoursLines = (lines: string[]) => lines.filter((l) => { TIME.lastIndex = 0; const t = TIME.test(l); TIME.lastIndex = 0; return t && HOURSY.test(l) && !EVENT.test(l) && l.length < 300; });
const times = (lines: string[]) => new Set(lines.flatMap((l) => (l.match(TIME) ?? []).map((t) => t.toLowerCase().replace(/[\s.]/g, ""))));

// Pure, exported for tests. Turns one page diff into a feed kind (or null when nothing a caller cares about changed).
export function classify(added: string[], removed: string[]): { kind: FeedEntry["kind"]; summary: string; after: string[] } | null {
  const closure = added.filter((l) => CLOSURE.test(l) && WHEN.test(l) && l.length < 400);
  if (closure.length) return { kind: "new_closure", summary: `New closure notice: ${closure[0].slice(0, 160)}`, after: closure };
  const after = hoursLines(added), before = hoursLines(removed);
  const a = times(after), b = times(before);
  const changed = [...a].some((t) => !b.has(t)) || [...b].some((t) => !a.has(t));
  if (after.length && changed) {
    return { kind: "hours_changed", summary: `Hours text changed: "${(before[0] ?? "").slice(0, 70)}" is now "${(after[0] ?? "").slice(0, 70)}"`, after };
  }
  return null;
}

async function main() {
  const arg = (f: string) => process.argv[process.argv.indexOf(f) + 1];
  const max = process.argv.includes("--max") ? Number(arg("--max")) : Infinity;
  const sites: any[] = JSON.parse(await readFile(new URL("../data/seed/sites.json", import.meta.url), "utf8"));
  const bySource = new Map<string, any[]>();
  for (const s of sites) {
    const u = s.source_url as string;
    if (/^https?:/.test(u) && !/google\.[a-z.]+\/maps|maps\.app\.goo/.test(u)) bySource.set(u, [...(bySource.get(u) ?? []), s]);
  }
  const urls = [...bySource.keys()].slice(0, max);
  console.log(`re-crawling ${urls.length} pages`);

  const feed: FeedEntry[] = [];
  const counts = { new: 0, changed: 0, unchanged: 0, failed: 0 };
  let next = 0;
  await Promise.all(Array.from({ length: Number(process.env.FETCH_CONCURRENCY ?? 5) }, async () => {
    while (next < urls.length) {
      const u = urls[next++];
      let ch: Change;
      try { ch = await record(u, await fetchPage(u, { fresh: true })); } catch { counts.failed++; continue; }
      counts[ch.kind]++;
      if (ch.kind !== "changed") continue;
      const c = classify(ch.added_lines, ch.removed_lines);
      if (!c) continue;
      const owners = bySource.get(u)!;
      feed.push({
        id: createHash("sha1").update(`${u}|${ch.content_hash}`).digest("hex").slice(0, 16), detected_at: new Date().toISOString(),
        kind: c.kind, url: u, site_ids: owners.map((s) => s.id), site_names: owners.map((s) => s.name), summary: c.summary,
        before: ch.removed_lines.slice(0, 8), after: c.after.slice(0, 8),
      });
    }
  }));
  console.log(`pages: ${counts.changed} changed, ${counts.unchanged} unchanged, ${counts.new} new, ${counts.failed} failed → ${feed.length} feed entries`);

  const file = new URL("../data/seed/changes_feed.json", import.meta.url);
  const old: { runs: { at: string; pages: number; changed: number }[]; entries: FeedEntry[] } =
    JSON.parse(await readFile(file, "utf8").catch(() => '{"runs":[],"entries":[]}'));
  const known = new Set(old.entries.map((e) => e.id));
  const fresh = feed.filter((e) => !known.has(e.id));
  const entries = [...fresh, ...old.entries].slice(0, 500);
  const runs = [{ at: new Date().toISOString(), pages: urls.length, changed: counts.changed }, ...old.runs].slice(0, 60);
  await writeFile(file, JSON.stringify({ runs, entries }, null, 1) + "\n");
  for (const e of fresh) console.log(`  ${e.kind}: ${e.site_names[0]} — ${e.summary}`);

  if (process.argv.includes("--push") && fresh.length) {
    const { Client } = createRequire(import.meta.url)("pg");
    const db = new Client({ connectionString: (process.env.NEON_DATABASE_URL_UNPOOLED ?? process.env.NEON_DATABASE_URL)?.replace(/^"|"$/g, "") });
    await db.connect();
    for (const e of fresh)
      await db.query(
        `insert into site_changes (id, detected_at, kind, url, site_ids, site_names, summary, before, after)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`,
        [e.id, e.detected_at, e.kind, e.url, e.site_ids, e.site_names, e.summary, JSON.stringify(e.before), JSON.stringify(e.after)]);
    await db.end();
    console.log(`pushed ${fresh.length} rows to Neon site_changes`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

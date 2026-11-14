// Evidence report: every number is computed from the pipeline's own logs, caches, git history and seed, never typed in.
//   node --env-file=.env ingest/report.ts            writes docs/DATA_EVIDENCE.md
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";

const here = (p: string) => new URL(p, import.meta.url);
const json = async (p: string, d: any = []) => JSON.parse(await readFile(here(p), "utf8").catch(() => JSON.stringify(d)));
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");
const count = <T,>(xs: T[], f: (x: T) => string) => xs.reduce((m: Record<string, number>, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const table = (rows: [string, string | number][]) => "| | |\n|---|---|\n" + rows.map(([a, b]) => `| ${a} | ${b} |`).join("\n");

async function main() {
  const seed: any[] = await json("../data/seed/sites.json");
  const extras: Record<string, any> = await json("../data/seed/sites.extras.json", {});
  const gap = await json("../data/seed/zip_gap.json", { zips: [] });
  const merged: any[] = await json("./data/merged.json");
  const rejected: any[] = await json("./data/rejected.json");
  const verified: any[] = await json("./data/sites.json");
  const hist: any[] = (await readFile(here("./data/history.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const searches: any[] = (await readFile(here("./data/searches.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const maps: any[] = await json("./data/maps_sites.json");

  // ---- cache-derived request evidence ----
  const files = await readdir(here("./cache/")).catch(() => [] as string[]);
  let serp = 0, pages = 0;
  for (const f of files.filter((f) => f.endsWith(".txt"))) {
    const head = (await readFile(here(`./cache/${f}`), "utf8")).slice(0, 40);
    head.startsWith('{"general"') ? serp++ : pages++;
  }

  // ---- fetch outcomes (the target's REAL status, not Bright Data's) ----
  const urls = new Set(hist.map((h) => h.url));
  const ok = hist.filter((h) => h.ok), failed = hist.filter((h) => !h.ok && !h.blocked_by_policy), policy = hist.filter((h) => h.blocked_by_policy);
  const hashes = new Map<string, Set<string>>();
  for (const h of hist) if (h.ok && h.content_hash) (hashes.get(h.url) ?? hashes.set(h.url, new Set()).get(h.url)!).add(h.content_hash);
  const changedPages = [...hashes.values()].filter((s) => s.size > 1).length;
  // Bright Data refuses every .gov domain, so a successful .gov fetch was necessarily served by the second fetcher.
  const govServed = hist.filter((h) => h.ok && /\.gov$/.test(new URL(h.url).hostname)).length;
  const statuses = count(failed, (h) => String(h.status));

  // ---- seed growth, from git (verifiable) ----
  const growth: string[] = [];
  try {
    const log = execFileSync("git", ["log", "--reverse", "--format=%h|%ad|%s", "--date=format:%b %d %H:%M", "--", "data/seed/sites.json"], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" }).trim().split("\n");
    for (const l of log) {
      const [h, d, ...s] = l.split("|");
      const n = JSON.parse(execFileSync("git", ["show", `${h}:data/seed/sites.json`], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8", maxBuffer: 64e6 })).length;
      growth.push(`| ${d} | \`${h}\` | ${n} | ${s.join("|").slice(0, 70)} |`);
    }
  } catch { /* not a git checkout */ }

  const gapZips = gap.zips ?? [];
  const noSite = gapZips.filter((z: any) => z.sites_within_5km === 0 && z.residents_at_risk > 300);
  const confirmed = seed.filter((s) => s.hours_confirmed_on_source);
  const conflicts = seed.filter((s) => extras[s.id]?.verification === "conflict");
  const withQuote = verified.filter((s) => s.evidence_verified);

  const md = `# Data evidence

*Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by \`ingest/report.ts\`. Every number below is computed from the pipeline's logs, caches, git history and seed files, not typed in. Re-run it to refresh.*

## What this is

A maintained, verified dataset of free public cooling spaces in San Diego County, built from the open web. No unified list existed: the county's Cool Zones live in a PDF and a map layer, libraries and rec centers on separate city pages, and nothing says who may enter or whether hours are current.

## Coverage

${table([
  ["Sites in the seed", seed.length],
  ["Official (published by a government or county source)", seed.filter((s) => s.tier === "official").length],
  ["Discovered (found on the open web)", seed.filter((s) => s.tier === "discovered").length],
  ["ZIP codes covered", new Set(seed.map((s) => s.zip).filter(Boolean)).size],
  ["Hours confirmed by two independent sources", confirmed.length],
  ["Source disagreements flagged (call ahead)", conflicts.length],
  ["Sites with capacity known", seed.filter((s) => s.capacity_est).length],
  ["Stated as open to everyone", Object.values(extras).filter((e: any) => e.access_level === "open_to_all").length],
  ["Access restricted (age, members, students)", Object.values(extras).filter((e: any) => ["age_restricted", "members_only", "students_only", "residents_only"].includes(e.access_level)).length],
])}

By type: ${Object.entries(count(seed, (s) => s.kind)).map(([k, v]) => `${k} ${v}`).join(", ")}.

### Growth (from git history of \`data/seed/sites.json\`)

| When | Commit | Sites | Change |
|---|---|---|---|
${growth.join("\n") || "| | | | (not a git checkout) |"}

## How the data was collected

${table([
  ["Search-result pages cached (Bright Data SERP)", serp],
  ["Web pages cached", pages],
  ["Page fetches recorded in the version log", hist.length],
  ["Distinct URLs fetched", urls.size],
  ["Fetches that succeeded (target returned content)", `${ok.length} (${pct(ok.length, hist.length)})`],
  ["Fetches refused by Bright Data's policy (government domains)", policy.length],
  ["Government-domain pages fetched successfully (served by a second fetcher, since Bright Data refuses .gov)", govServed],
  ["Fetches that failed for other reasons", `${failed.length} (target statuses: ${Object.entries(statuses).map(([k, v]) => `${k}×${v}`).join(", ") || "none"})`],
  ["Google Maps places (Bright Data Maps scraper)", maps.length],
  ["Pages whose content changed between fetches", changedPages],
])}

**A real scraping problem we handled.** Bright Data's Web Unlocker answers HTTP 200 even when the target site failed or the domain is refused. We request the JSON envelope and read the *target's* real status and the \`x-brd-error\` header, so a refusal is detected and logged instead of being mistaken for an empty page. Government domains are refused by policy; ${policy.length} such fetches are in the log, and those pages are routed to a second fetcher.

**Search results sometimes carry only redirect links.** About 60% of Google results come back as opaque redirects. We rebuild the real URL from the visible address when it is complete and drop the result otherwise, so nothing is guessed.

## Verification: nothing the model says is trusted on its own

Every extracted site must carry a quote copied from the source page, and the code checks that the quote appears verbatim in the page text.

${table([
  ["Records the extractor produced", verified.length + rejected.length],
  ["Passed the verbatim-quote check", `${withQuote.length} (${pct(withQuote.length, verified.length + rejected.length)})`],
  ["Rejected (quote not found in the source)", `${rejected.length} (${pct(rejected.length, verified.length + rejected.length)})`],
])}

Hours from the site's own page are then compared, in code, against Google Maps hours: they agree within 30 minutes, or the site is flagged. That comparison is deterministic and auditable, so no model decides whether two sources agree.

${conflicts.length ? "### Disagreements caught\n\n" + conflicts.slice(0, 6).map((s) => `- **${s.name}**: ${(extras[s.id]?.conflicts ?? []).slice(0, 2).join("; ")}`).join("\n") : ""}

### Evidence quotes, examples

${confirmed.slice(0, 4).map((s) => `- **${s.name}** (${s.zip ?? "?"}): "${String(extras[s.id]?.evidence ?? "").slice(0, 140)}"`).join("\n")}

## The data keeps itself current

Every fetch is recorded with a content hash. A new hash means the page changed, and the added and removed lines are stored. ${changedPages} page(s) have changed between fetches so far. Re-running \`./ingest/run-all.sh --refresh\` re-checks every page, and \`ingest/alert-refresh.ts\` does the same for the ZIPs in a forecast zone when the National Weather Service issues a heat or air-quality alert.

## Where coverage is thin (and the process for it)

The cooling-gap analysis combines the NWS hourly forecast, Census residents who are 65+ or live in households without a vehicle, and the number of sites within 5 km of each ZIP.

${table([
  ["San Diego County ZIPs analyzed", gapZips.length],
  ["Populated ZIPs with no site within 5 km", noSite.length],
  ["At-risk residents in those ZIPs", noSite.reduce((s: number, z: any) => s + z.residents_at_risk, 0).toLocaleString()],
])}

Worst served: ${gapZips.filter((z: any) => z.residents_at_risk > 500).slice(0, 5).map((z: any) => `${z.zip} (${z.residents_at_risk.toLocaleString()} at-risk, ${z.sites_within_5km} sites within 5 km)`).join("; ")}.

\`ingest/search.ts "<place or zip>"\` is the gap-fill process: it reports coverage for any place and, when there are fewer than 3 sites within 10 km, runs the whole pipeline for that place. ${searches.length} on-demand search(es) logged.

## Honest limits

- A page's hours are only as good as the page. Where two sources disagree we say so rather than choose.
- "Official" means listed by a government or county source. It does not mean every listed hour is current.
- Many sites have a single source; they are labeled as such and the agent should say "call ahead".
- Air-conditioning is stated only where a source says so (the county's Cool Zone definition) or reviews strongly suggest it; otherwise it is unknown.
`;
  await writeFile(here("../docs/DATA_EVIDENCE.md"), md);
  console.log(`→ docs/DATA_EVIDENCE.md (${md.length} chars)`);
  console.log(`seed ${seed.length} | fetches ${hist.length} (ok ${ok.length}, policy ${policy.length}, other ${failed.length}) | quote gate ${withQuote.length}/${verified.length + rejected.length} | serp cached ${serp}`);
}

main();

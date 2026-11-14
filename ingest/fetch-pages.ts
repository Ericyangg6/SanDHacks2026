// Step 2: fetch each candidate's own page as markdown (Web Unlocker), record a versioned
// snapshot, and detect changes since the last run. Run it repeatedly to see changes.
//   node --env-file=.env ingest/fetch-pages.ts [maxPages]        (uses cache; cheap)
//   node --env-file=.env ingest/fetch-pages.ts 40 --refresh      (re-fetch live; detects edits)
//
// Bright Data refuses some domains by policy (all .gov). For those we fall back to the
// search-result snippet, which usually carries the hours, and label it as lower confidence.
import { readFile, writeFile } from "node:fs/promises";
import { fetchPage, stats } from "./brightdata.ts";
import { record, type Change } from "./history.ts";
import type { Candidate } from "./discover.ts";

const MAX = Number(process.argv[2] ?? 40); // credit guard
const REFRESH = process.argv.includes("--refresh");

// Phrases that signal who may enter; flagged here, interpreted by Gemini later.
const ACCESS_HINTS =
  /(students? only|members? only|membership|residents? only|must be \d+|ages? \d+\+?|\d+\+|seniors?|id required|photo id|admission|fee|reservation|appointment|open to (the )?public|all are welcome|community (borrower|access))/gi;

async function main() {
  const candidates: Candidate[] = JSON.parse(
    await readFile(new URL("./data/candidates.json", import.meta.url), "utf8"),
  );

  // One page per domain per area first (cheapest useful coverage).
  const seen = new Set<string>();
  const queue = candidates
    .filter((c) => {
      const k = `${c.area}|${c.domain}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX);

  const pages: any[] = [];
  const changes: Change[] = [];
  for (const c of queue) {
    try {
      const r = await fetchPage(c.url, { fresh: REFRESH });
      // Cached reads are not new observations; only record live fetches.
      if (!r.from_cache) changes.push(await record(c.url, r));

      if (r.ok) {
        const hints = [...new Set((r.markdown.match(ACCESS_HINTS) ?? []).map((s) => s.toLowerCase()))];
        pages.push({ ...c, source_type: "page", fetched_at: new Date().toISOString(), access_hints: hints, markdown: r.markdown.slice(0, 20000) });
        console.log(`✓ ${c.domain} (${r.markdown.length} chars${r.from_cache ? ", cached" : ""}${r.via ? ", via fallback (.gov)" : ""}, hints: ${hints.slice(0, 4).join(", ") || "none"})`);
      } else if (c.snippet && c.snippet.length > 60) {
        // Fallback: the SERP snippet. Lower trust, and labeled so downstream code knows.
        pages.push({
          ...c, source_type: "serp_snippet", fetched_at: new Date().toISOString(), access_hints: [],
          markdown: `${c.title}\n${c.snippet}`, fetch_error: r.error ?? `status ${r.status}`,
        });
        console.log(`△ ${c.domain} → ${r.blocked_by_policy ? "blocked by Bright Data policy" : `status ${r.status}`}; using search snippet`);
      } else {
        console.log(`✗ ${c.domain} → ${r.error ?? `status ${r.status}`}`);
      }
    } catch (e) {
      console.error(`✗ ${c.url}: ${(e as Error).message}`);
    }
  }

  await writeFile(new URL("./data/pages.json", import.meta.url), JSON.stringify(pages, null, 2));
  await writeFile(new URL("./data/changes.json", import.meta.url), JSON.stringify(changes, null, 2));
  const n = (k: string) => changes.filter((x) => x.kind === k).length;
  console.log(
    `\n${pages.length} pages → ingest/data/pages.json | live fetches: ${n("new")} new, ${n("changed")} changed, ${n("unchanged")} unchanged, ${n("failed")} failed (${stats().requests} API requests)`,
  );
  for (const ch of changes.filter((x) => x.kind === "changed")) {
    console.log(`\nCHANGED ${ch.url}\n  + ${ch.added_lines.slice(0, 3).join("\n  + ")}\n  - ${ch.removed_lines.slice(0, 3).join("\n  - ")}`);
  }
}

main();

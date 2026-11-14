// Step 4: cross-source verification. Match Google Maps records to Gemini-extracted web
// records, compare hours, and label every site by how well it is corroborated.
//   node --env-file=.env ingest/merge.ts
//
//   confirmed  : 2+ independent sources agree on hours
//   conflict   : sources disagree (flagged; the agent should say "call ahead")
//   maps_only / web_only : one source
// Hours comparison is code, not an LLM, so the verdict is deterministic and auditable.
import { readFile, writeFile } from "node:fs/promises";

type Slot = { day: string; open: string; close: string };
const load = async (f: string) => JSON.parse(await readFile(new URL(`./data/${f}`, import.meta.url), "utf8").catch(() => "[]"));

const tokens = (s: string) =>
  new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !["the", "and", "center", "branch"].includes(t)));
const jaccard = (a: Set<string>, b: Set<string>) => {
  const i = [...a].filter((x) => b.has(x)).length;
  return i / (a.size + b.size - i || 1);
};
const streetKey = (addr?: string | null) => (addr ?? "").toLowerCase().match(/^\d+\s+\w+/)?.[0] ?? null;
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function sameSite(m: any, w: any): boolean {
  const ka = streetKey(m.address), kb = streetKey(w.address);
  if (ka && kb && ka === kb) return true;
  return jaccard(tokens(m.name), tokens(w.name)) >= 0.6;
}

/** Compare weekly hours: agree if every shared day opens/closes within 30 minutes. */
function compareHours(a: Slot[], b: Slot[]) {
  const A = new Map(a.map((s) => [s.day, s])), B = new Map(b.map((s) => [s.day, s]));
  const shared = [...A.keys()].filter((d) => B.has(d));
  if (!shared.length) return { verdict: "no_overlap" as const, diffs: [] as string[] };
  const diffs = shared
    .filter((d) => Math.abs(mins(A.get(d)!.open) - mins(B.get(d)!.open)) > 30 || Math.abs(mins(A.get(d)!.close) - mins(B.get(d)!.close)) > 30)
    .map((d) => `${d}: maps ${A.get(d)!.open}-${A.get(d)!.close} vs web ${B.get(d)!.open}-${B.get(d)!.close}`);
  return { verdict: diffs.length ? ("conflict" as const) : ("agree" as const), diffs };
}

async function main() {
  const maps: any[] = await load("maps_sites.json");
  const web: any[] = await load("sites.json");
  const used = new Set<number>();
  const merged: any[] = [];

  for (const m of maps) {
    const wi = web.findIndex((w, i) => !used.has(i) && sameSite(m, w));
    if (wi === -1) {
      merged.push({ ...m, verification: "maps_only", sources: ["google_maps"], conflicts: [] });
      continue;
    }
    used.add(wi);
    const w = web[wi];
    const cmp = compareHours(m.hours ?? [], w.hours ?? []);
    merged.push({
      ...m,
      // Prefer the site's own page for access rules; Maps for coordinates and phone.
      access_level: w.access_level, access_notes: w.access_notes, requires_id: w.requires_id, has_fee: w.has_fee, has_ac: w.has_ac,
      verification: cmp.verdict === "agree" ? "confirmed" : cmp.verdict === "conflict" ? "conflict" : "single_hours_source",
      sources: ["google_maps", w.source_url],
      conflicts: cmp.diffs,
      evidence: w.evidence,
    });
  }
  web.forEach((w, i) => !used.has(i) && merged.push({ ...w, verification: "web_only", sources: [w.source_url], conflicts: [] }));

  await writeFile(new URL("./data/merged.json", import.meta.url), JSON.stringify(merged, null, 2));

  const count = (v: string) => merged.filter((s) => s.verification === v).length;
  const history = (await readFile(new URL("./data/history.jsonl", import.meta.url), "utf8").catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.log(`\n=== COVERAGE REPORT ===`);
  console.log(`sites total:            ${merged.length}`);
  console.log(`  confirmed (2 sources): ${count("confirmed")}`);
  console.log(`  conflicts flagged:     ${count("conflict")}`);
  console.log(`  maps only / web only:  ${count("maps_only")} / ${count("web_only")}`);
  console.log(`  with coordinates:      ${merged.filter((s) => s.lat).length}`);
  console.log(`  open to all (verified):${merged.filter((s) => s.access_level === "open_to_all").length}`);
  console.log(`page fetches recorded:   ${history.length} (${history.filter((h: any) => h.blocked_by_policy).length} blocked by Bright Data policy → fell back to snippets)`);
  for (const s of merged.filter((x) => x.verification === "conflict")) console.log(`\n⚠ ${s.name}\n  ${s.conflicts.join("\n  ")}`);
  console.log(`\n→ ingest/data/merged.json`);
}

main();

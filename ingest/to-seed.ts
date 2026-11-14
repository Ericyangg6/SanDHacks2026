// Step 5: convert merged ingest output into the team contract (data/schema/types.ts `Site`).
//   node --env-file=.env ingest/to-seed.ts
// Writes:
//   data/seed/sites.json         Site[] exactly as in types.ts (what everyone develops against)
//   data/seed/sites.extras.json  provenance not in the schema yet (access rules, verification, evidence),
//                                keyed by site id; see data/schema/proposals/ for the schema proposal.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const DAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } as const;
const KINDS = ["cool_zone", "library", "rec_center", "community_center", "senior_center", "mall", "other"];

function kindOf(s: any): string {
  if (KINDS.includes(s.kind)) return s.kind; // extracted kind wins when valid
  const t = `${s.category ?? ""} ${s.name ?? ""}`.toLowerCase();
  if (/cool zone|cooling/.test(t)) return "cool_zone";
  if (/librar/.test(t)) return "library";
  if (/senior|adult enrichment|nutrition/.test(t)) return "senior_center";
  if (/community/.test(t)) return "community_center";
  if (/recreation|rec center|park|pool|aquatic/.test(t)) return "rec_center";
  if (/mall|shopping/.test(t)) return "mall";
  return "other";
}

// Confidence heuristic (documented, not model-reported): how many independent sources agree.
//   confirmed (Maps + site's own page agree): 0.9 | single structured source (Maps): 0.6
//   web page only: the extractor's own score   | sources conflict: 0.3
function confidenceOf(s: any): number {
  switch (s.verification) {
    case "confirmed": return 0.9;
    case "conflict": return 0.3;
    case "maps_only": return 0.6;
    default: return Math.min(Math.max(s.confidence ?? 0.4, 0), 1);
  }
}

async function main() {
  const merged: any[] = JSON.parse(await readFile(new URL("./data/merged.json", import.meta.url), "utf8"));
  const sites: any[] = [];
  const extras: Record<number, any> = {};
  const skipped = { no_coords: 0, no_hours: 0, no_address: 0 };

  for (const s of merged) {
    if (typeof s.lat !== "number" || typeof s.lon !== "number") { skipped.no_coords++; continue; }
    if (!s.address) { skipped.no_address++; continue; }
    const weekly = (s.hours ?? [])
      .filter((h: any) => h.day in DAY)
      .map((h: any) => ({ day: DAY[h.day as keyof typeof DAY], open: h.open, close: h.close }));
    if (!weekly.length) { skipped.no_hours++; continue; } // nothing to recommend without hours

    const id = sites.length + 1;
    const confirmed = s.verification === "confirmed";
    sites.push({
      id,
      name: s.name,
      kind: kindOf(s),
      tier: "discovered", // nothing here comes from an official list
      confidence: confidenceOf(s),
      address: s.address,
      zip: s.address.match(/\b9\d{4}\b/)?.[0] ?? null,
      lat: s.lat,
      lon: s.lon,
      hours: { weekly, ...(s.hours_raw ? { raw_text: JSON.stringify(s.hours_raw) } : {}) },
      hours_confirmed_on_source: confirmed,
      has_ac: typeof s.has_ac === "boolean" ? s.has_ac : null, // only when a page says so
      has_filtration: null,
      capacity_est: null,
      phone: s.phone ?? null,
      source_url: confirmed ? (s.sources?.[1] ?? s.source_url) : (s.source_url ?? s.sources?.[0]),
      last_verified_at: s.fetched_at ?? new Date().toISOString(),
    });
    extras[id] = {
      access_level: s.access_level ?? "unknown",
      access_notes: s.access_notes ?? null,
      requires_id: s.requires_id ?? null,
      has_fee: s.has_fee ?? null,
      verification: s.verification,
      sources: s.sources ?? [],
      conflicts: s.conflicts ?? [],
      evidence: s.evidence ?? null,
      maps_place_id: s.place_id ?? null,
    };
  }

  // Contract check: required, non-null fields from schema.sql.
  const bad = sites.filter((x) => !x.name || !x.kind || !x.address || x.lat == null || x.lon == null || !x.source_url || !x.last_verified_at);
  if (bad.length) throw new Error(`${bad.length} sites violate the contract, e.g. ${bad[0].name}`);

  await mkdir(new URL("../data/seed/", import.meta.url), { recursive: true });
  await writeFile(new URL("../data/seed/sites.json", import.meta.url), JSON.stringify(sites, null, 2) + "\n");
  await writeFile(new URL("../data/seed/sites.extras.json", import.meta.url), JSON.stringify(extras, null, 2) + "\n");

  const by = (f: (x: any) => string) => sites.reduce((m: any, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  console.log(`${sites.length} sites → data/seed/sites.json  (skipped: ${JSON.stringify(skipped)})`);
  console.log("by kind:", by((x) => x.kind));
  console.log("by zip (top):", Object.entries(by((x) => x.zip ?? "?")).sort((a: any, b: any) => b[1] - a[1]).slice(0, 6));
  console.log("confirmed on source:", sites.filter((x) => x.hours_confirmed_on_source).length);
}

main();

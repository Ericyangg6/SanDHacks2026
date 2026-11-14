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

// The same place often appears on several pages (county list, city list, its own page). Keep one record,
// preferring official sources, then more hours, then higher extractor confidence; remember every source.
function dedupeWeb(records: any[]): any[] {
  const key = (r: any) => streetKey(r.address) ?? [...tokens(r.name)].sort().join(" ");
  const score = (r: any) => (r.tier === "official" ? 1000 : 0) + (r.hours?.length ?? 0) * 10 + (r.confidence ?? 0);
  const groups = new Map<string, any[]>();
  for (const r of records) (groups.get(key(r)) ?? groups.set(key(r), []).get(key(r))!).push(r);
  return [...groups.values()].map((g) => {
    const best = { ...g.sort((a, b) => score(b) - score(a))[0] };
    best.also_listed_at = [...new Set(g.map((x) => x.source_url).filter((u) => u !== best.source_url))];
    if (g.some((x) => x.tier === "official")) best.tier = "official";
    return best;
  });
}

const toRad = (d: number) => (d * Math.PI) / 180;
function meters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371000, dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Official zone <-> extracted web record: same street number + street word (and zip when both have one), or very similar name.
function matchZone(z: any, w: any): boolean {
  const kz = streetKey(z.street), kw = streetKey(w.address);
  const zipOk = !z.zip || !w.address || (w.address.match(/\b9\d{4}\b/)?.[0] ?? z.zip) === z.zip;
  if (kz && kw && kz === kw && zipOk) return true;
  return jaccard(tokens(z.name), tokens(w.name)) >= 0.6;
}

async function main() {
  const maps: any[] = await load("maps_sites.json");
  const web: any[] = dedupeWeb(await load("sites.json"));
  const zones: any[] = await load("official_cool_zones.json");
  const usedM = new Set<number>(), usedW = new Set<number>();
  const merged: any[] = [];

  // 1) The county's official Cool Zones are the spine: authoritative location, capacity, phone, pet policy.
  //    Hours come from the official PDF/page (web) and Google Maps; two agreeing sources = confirmed.
  for (const z of zones) {
    const mi = maps.findIndex((m, i) => !usedM.has(i) && typeof m.lat === "number" && meters(m, z) < 150);
    const wi = web.findIndex((w, i) => !usedW.has(i) && matchZone(z, w));
    const M = mi >= 0 ? maps[mi] : null, W = wi >= 0 ? web[wi] : null;
    if (M) usedM.add(mi);
    if (W) usedW.add(wi);

    let verification = "listed_only", hours: Slot[] = [], conflicts: string[] = [];
    if (M && W) {
      const cmp = compareHours(M.hours ?? [], W.hours ?? []);
      verification = cmp.verdict === "agree" ? "confirmed" : cmp.verdict === "conflict" ? "conflict" : "single_hours_source";
      conflicts = cmp.diffs;
      hours = W.hours?.length ? W.hours : M.hours ?? [];
    } else if (W?.hours?.length) { verification = "web_only"; hours = W.hours; }
    else if (M?.hours?.length) { verification = "maps_only"; hours = M.hours; }

    merged.push({
      ...(M ?? {}),
      name: M?.name ?? z.name, official_name: z.name, category: M?.category ?? W?.kind ?? "Cool Zone",
      address: z.address, lat: z.lat, lon: z.lon, phone: z.phone ?? M?.phone ?? null,
      hours, hours_raw: M?.hours_raw ?? null, tier: "official", capacity: z.capacity, pet_policy: z.pet_policy,
      // County program definition: Cool Zones are "free, air-conditioned places". Recorded as the source of these two facts.
      has_ac: true, ac_from: "official_program",
      access_level: W && W.access_level && W.access_level !== "unknown" ? W.access_level : "open_to_all",
      access_notes: W?.access_notes ?? "Listed as a County of San Diego Cool Zone (free, air-conditioned public space)",
      requires_id: W?.requires_id ?? null, has_fee: W?.has_fee ?? null,
      verification, conflicts, evidence: W?.evidence ?? null,
      place_id: M?.place_id ?? null,
      source_url: W?.source_url ?? M?.source_url ?? null,
      sources: ["county_cool_zones_layer", ...(M ? ["google_maps"] : []), ...(W ? [W.source_url] : [])],
      also_listed_at: W?.also_listed_at ?? [],
      fetched_at: W?.last_verified_at ?? M?.fetched_at ?? new Date().toISOString(),
    });
  }

  // 2) Everything else: Google Maps sites, cross-checked against their own web page when we have one.
  for (const [mi, m] of maps.entries()) {
    if (usedM.has(mi)) continue;
    const wi = web.findIndex((w, i) => !usedW.has(i) && sameSite(m, w));
    if (wi === -1) {
      merged.push({ ...m, verification: "maps_only", sources: ["google_maps"], conflicts: [] });
      continue;
    }
    usedW.add(wi);
    const w = web[wi];
    const cmp = compareHours(m.hours ?? [], w.hours ?? []);
    merged.push({
      ...m,
      // Prefer the site's own page for access rules; Maps for coordinates and phone.
      tier: w.tier, also_listed_at: w.also_listed_at ?? [],
      access_level: w.access_level, access_notes: w.access_notes, requires_id: w.requires_id, has_fee: w.has_fee, has_ac: w.has_ac,
      verification: cmp.verdict === "agree" ? "confirmed" : cmp.verdict === "conflict" ? "conflict" : "single_hours_source",
      sources: ["google_maps", w.source_url],
      source_url: cmp.verdict === "agree" ? w.source_url : m.source_url,
      conflicts: cmp.diffs,
      evidence: w.evidence,
    });
  }
  web.forEach((w, i) => !usedW.has(i) && merged.push({ ...w, verification: "web_only", sources: [w.source_url], conflicts: [] }));

  await writeFile(new URL("./data/merged.json", import.meta.url), JSON.stringify(merged, null, 2));

  const count = (v: string) => merged.filter((s) => s.verification === v).length;
  const history = (await readFile(new URL("./data/history.jsonl", import.meta.url), "utf8").catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.log(`\n=== COVERAGE REPORT ===`);
  console.log(`sites total:             ${merged.length}  (official ${merged.filter((s) => s.tier === "official").length}, discovered ${merged.filter((s) => s.tier !== "official").length})`);
  console.log(`  confirmed (2 sources): ${count("confirmed")}`);
  console.log(`  conflicts flagged:     ${count("conflict")}`);
  console.log(`  official, no hours:    ${count("listed_only")}`);
  console.log(`  single source:         ${count("maps_only") + count("web_only") + count("single_hours_source")}`);
  console.log(`  with coordinates:      ${merged.filter((s) => s.lat).length}`);
  console.log(`  capacity known:        ${merged.filter((s) => s.capacity).length}`);
  console.log(`  open to all (stated):  ${merged.filter((s) => s.access_level === "open_to_all").length}`);
  console.log(`page fetches recorded:   ${history.length} (${history.filter((h: any) => h.blocked_by_policy).length} refused by Bright Data policy)`);
  for (const s of merged.filter((x) => x.verification === "conflict").slice(0, 8)) console.log(`\n⚠ ${s.name}\n  ${s.conflicts.slice(0, 3).join("\n  ")}`);
  console.log(`\n→ ingest/data/merged.json`);
}

main();

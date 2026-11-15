// Step 5: convert merged ingest output into the team contract (data/schema/types.ts `Site`).
//   node --env-file=.env ingest/to-seed.ts
// Writes:
//   data/seed/sites.json         Site[] exactly as in types.ts, SORTED: official first, then confirmed,
//                                then by zip, kind, name. IDs follow that order.
//   data/seed/sites.extras.json  provenance not in the schema yet (access rules, verification, evidence,
//                                review signals), keyed by site id. See data/schema/proposals/.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { geocode } from "./geocode.ts";

const DAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } as const;
const KINDS = ["cool_zone", "library", "rec_center", "community_center", "senior_center", "mall", "other"];
const load = async (f: string, dflt: any) => JSON.parse(await readFile(new URL(`./data/${f}`, import.meta.url), "utf8").catch(() => JSON.stringify(dflt)));

function kindOf(s: any): string {
  const t = `${s.category ?? ""} ${s.name ?? ""}`.toLowerCase();
  if (/shopping mall|\bmall\b/.test(t)) return "mall";
  if (KINDS.includes(s.kind) && s.kind !== "other") return s.kind; // extracted kind wins when specific
  if (/cool zone|cooling/.test(t)) return "cool_zone";
  if (/librar/.test(t)) return "library";
  if (/senior|adult enrichment|nutrition/.test(t)) return "senior_center";
  if (/community/.test(t)) return "community_center";
  if (/recreation|rec center|park|pool|aquatic|museum/.test(t)) return "rec_center";
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

// Strip malls and open-air plazas are not cooling spaces. Google's category is "Shopping mall" for both, so judge by NAME.
// Heuristic: a name that sounds like a strip center is downgraded unless it is a known enclosed mall. Official listings always pass.
const ENCLOSED_MALL = /\bmall\b|westfield|fashion valley|plaza bonita|parkway plaza|chula vista center|grossmont center|north county fair|the valley|galleria|town center|las americas premium/;
function openAirCenter(s: any): boolean {
  if (s.tier === "official" || kindOf(s) !== "mall") return false;
  const name = String(s.name ?? "").toLowerCase();
  return /plaza|center|crossings|faire|shoppes|village|marketplace|commons|square|outlets?|shopping|terra|springs|north|south|east|west/.test(name) && !ENCLOSED_MALL.test(name);
}

// AC from reviews is inferred, never certain: only when several reviews say so and none contradict.
function acFromReviews(sig: any): boolean | null {
  return sig && sig.ac_positive >= 2 && sig.ac_negative === 0 ? true : null;
}

// STABLE IDS. calls.site_id and the SMS tool reference sites by id, so a site must keep its id on every rebuild.
// Each site has a natural key (Google place id, county layer object id, else a hash of name + address). data/seed/site_ids.json
// remembers key -> id forever; new sites get the next free id. Output order is still sorted for readability.
type Registry = { next_id: number; ids: Record<string, number> };
const naturalKey = (s: any): string =>
  s.place_id ? `maps:${s.place_id}` : s.official_objectid != null ? `county:${s.official_objectid}`
  : `web:${createHash("sha1").update(`${String(s.name).toLowerCase()}|${String(s.address).toLowerCase()}`).digest("hex").slice(0, 16)}`;

async function main() {
  const merged: any[] = await load("merged.json", []);
  const signals: Record<string, any> = await load("review_signals.json", {});
  const registryFile = new URL("../data/seed/site_ids.json", import.meta.url);
  const registry: Registry | null = JSON.parse(await readFile(registryFile, "utf8").catch(() => "null"));
  const built: { site: any; extra: any; key: string }[] = [];
  const keysSeen = new Set<string>();
  const skipped: Record<string, number> = { no_coords: 0, no_hours: 0, no_address: 0 };
  let geocoded = 0;

  for (const s of merged) {
    // Housing is never a public cooling space (student dormitories, apartment complexes, residence halls).
    if (/dormitor|apartment|residence hall|housing|condominium|residential/i.test(`${s.category ?? ""} ${s.name ?? ""}`) && s.tier !== "official") { skipped.housing = (skipped.housing ?? 0) + 1; continue; }
    if (!s.address) { skipped.no_address++; continue; }
    const weekly = (s.hours ?? [])
      .filter((h: any) => h.day in DAY)
      .map((h: any) => ({ day: DAY[h.day as keyof typeof DAY], open: h.open, close: h.close }));
    if (!weekly.length) { skipped.no_hours++; continue; } // nothing to recommend without hours

    let { lat, lon } = s;
    if (typeof lat !== "number" || typeof lon !== "number") {
      const g = await geocode(s.address);
      if (!g) { skipped.no_coords++; continue; }
      ({ lat, lon } = g);
      geocoded++;
    }
    // Safety net: nothing outside San Diego County may enter the seed (bounding box around the county).
    if (lat < 32.5 || lat > 33.52 || lon < -117.62 || lon > -116.07) { skipped.out_of_county = (skipped.out_of_county ?? 0) + 1; continue; }
    const sig = signals[s.place_id];
    const confirmed = s.verification === "confirmed";
    let key = naturalKey(s);
    for (let n = 2; keysSeen.has(key); n++) key = `${naturalKey(s)}#${n}`; // two different places never share a key
    keysSeen.add(key);
    built.push({
      key,
      site: {
        name: s.name,
        kind: openAirCenter(s) ? "other" : kindOf(s),
        tier: s.tier === "official" ? "official" : "discovered",
        // Malls and shopping centers found only on Google Maps are NOT known to be cool, indoor or open to sit in.
        confidence: kindOf(s) === "mall" && s.tier !== "official" && s.verification !== "confirmed" ? Math.min(confidenceOf(s), 0.4) : confidenceOf(s),
        address: s.address,
        zip: s.address.match(/\b9\d{4}\b/)?.[0] ?? null,
        lat, lon,
        hours: { weekly, ...(s.hours_exceptions?.length ? { exceptions: s.hours_exceptions } : {}), ...(s.hours_raw ? { raw_text: JSON.stringify(s.hours_raw) } : {}) },
        hours_confirmed_on_source: confirmed,
        has_ac: typeof s.has_ac === "boolean" ? s.has_ac : acFromReviews(sig), // page statement wins; reviews infer
        has_filtration: null,
        capacity_est: typeof s.capacity === "number" ? s.capacity : null,
        phone: s.phone ?? null,
        source_url: s.source_url ?? s.sources?.[1] ?? s.sources?.[0],
        last_verified_at: s.fetched_at ?? new Date().toISOString(),
      },
      extra: {
        access_level: s.access_level ?? "unknown",
        access_notes: s.access_notes ?? null,
        requires_id: s.requires_id ?? null,
        has_fee: s.has_fee ?? null,
        verification: s.verification,
        sources: [...(s.sources ?? []), ...(s.also_listed_at ?? [])],
        conflicts: s.conflicts ?? [],
        evidence: s.evidence ?? null,
        maps_place_id: s.place_id ?? null,
        coords_from: s.tier === "official" ? "county_cool_zones_layer" : typeof s.lat === "number" ? "google_maps" : "census_geocoder",
        ac_from: s.ac_from ?? (typeof s.has_ac === "boolean" ? "site_page" : acFromReviews(sig) ? "reviews" : null),
        official_name: s.official_name ?? null,
        pet_policy: s.pet_policy ?? null,
        review_signals: sig
          ? { scanned: sig.reviews_scanned, ac_positive: sig.ac_positive, ac_negative: sig.ac_negative,
              crowded: sig.crowded, spacious: sig.spacious, quotes: sig.quotes }
          : null,
      },
    });
  }

  // Sort: official first, then better-verified, then geography, so IDs are stable and browsable.
  const rank = (b: any) => (b.site.tier === "official" ? 0 : 1) * 10 + (b.extra.verification === "confirmed" ? 0 : b.extra.verification === "conflict" ? 2 : 1);
  built.sort((a, b) =>
    rank(a) - rank(b) || (a.site.zip ?? "").localeCompare(b.site.zip ?? "") ||
    a.site.kind.localeCompare(b.site.kind) || a.site.name.localeCompare(b.site.name));

  // First run (no registry): number in the sorted order above. Later runs: keep every existing id, give new sites the next free one.
  const reg: Registry = registry ?? { next_id: 1, ids: {} };
  for (const b of built) if (reg.ids[b.key] == null) reg.ids[b.key] = reg.next_id++;
  const sites: any[] = [];
  const extras: Record<number, any> = {};
  for (const b of built) { const id = reg.ids[b.key]; sites.push({ id, ...b.site }); extras[id] = { ...b.extra, external_key: b.key }; }
  await writeFile(registryFile, JSON.stringify(reg, null, 1) + "\n");
  const newIds = registry ? built.filter((b) => !registry.ids[b.key]).length : built.length;

  // Contract check: required, non-null fields from schema.sql.
  const bad = sites.filter((x) => !x.name || !x.kind || !x.address || x.lat == null || x.lon == null || !x.source_url || !x.last_verified_at);
  if (bad.length) throw new Error(`${bad.length} sites violate the contract, e.g. ${bad[0].name}`);

  await mkdir(new URL("../data/seed/", import.meta.url), { recursive: true });
  await writeFile(new URL("../data/seed/sites.json", import.meta.url), JSON.stringify(sites, null, 2) + "\n");
  await writeFile(new URL("../data/seed/sites.extras.json", import.meta.url), JSON.stringify(extras, null, 2) + "\n");

  const by = (f: (x: any) => string) => sites.reduce((m: any, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  console.log(`${sites.length} sites → data/seed/sites.json  (${newIds} new ids; geocoded ${geocoded}; skipped: ${JSON.stringify(skipped)})`);
  console.log("by tier:", by((x) => x.tier), "| by kind:", by((x) => x.kind));
  console.log("confirmed on source:", sites.filter((x) => x.hours_confirmed_on_source).length, "| has_ac known:", sites.filter((x) => x.has_ac !== null).length);
  console.log("zips covered:", new Set(sites.map((x) => x.zip).filter(Boolean)).size);
}

main();

// Step 6: load the seed into a Neon branch.
//   node --env-file=.env ingest/load-neon.ts
//
// SAFETY: reads NEON_INGEST_DEV_URL only (a Neon branch, e.g. "ingest-dev"). It never falls back to
// NEON_DATABASE_URL, which points at production, and it refuses a URL that matches production's.
// It also applies the draft schema proposal (data/schema/proposals/) to the branch if missing.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const { Client } = createRequire(import.meta.url)("pg");
const url = process.env.NEON_INGEST_DEV_URL?.replace(/^"|"$/g, "");
const prod = process.env.NEON_DATABASE_URL?.replace(/^"|"$/g, "");
if (!url) throw new Error("Set NEON_INGEST_DEV_URL (a non-production Neon branch)");
const host = (u: string) => new URL(u).hostname.replace("-pooler", "");
if (prod && host(url) === host(prod)) throw new Error("NEON_INGEST_DEV_URL points at production; refusing.");

const read = async (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");
const VERIFICATION: Record<string, string> = {
  confirmed: "confirmed", conflict: "conflict", maps_only: "single_source", single_hours_source: "single_source", web_only: "web_only",
};

async function main() {
  const db = new Client({ connectionString: url });
  await db.connect();

  // 1. Apply the schema proposal once (columns + enums + source_page_versions).
  const has = await db.query("select 1 from information_schema.columns where table_name='sites' and column_name='access_level'");
  if (!has.rowCount) {
    const md = await read("../data/schema/proposals/m2-ingest-provenance.md");
    const sql = md.match(/```sql\n([\s\S]*?)```/)?.[1];
    if (!sql) throw new Error("no SQL block in proposal");
    await db.query("begin");
    await db.query(sql);
    await db.query("commit");
    console.log("applied schema proposal to branch");
  } else console.log("schema proposal already applied");

  // 2. Upsert sites (keyed by Google place id so re-runs never duplicate).
  const sites = JSON.parse(await read("../data/seed/sites.json"));
  const extras = JSON.parse(await read("../data/seed/sites.extras.json"));
  await db.query("begin");
  for (const s of sites) {
    const x = extras[s.id] ?? {};
    await db.query(
      `insert into sites (name, kind, tier, confidence, address, zip, lat, lon, hours, hours_confirmed_on_source,
         has_ac, has_filtration, capacity_est, phone, source_url, last_verified_at,
         access_level, access_notes, requires_id, has_fee, verification, conflicts, evidence, source_urls, maps_place_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       on conflict (maps_place_id) do update set
         name=excluded.name, kind=excluded.kind, confidence=excluded.confidence, address=excluded.address, zip=excluded.zip,
         lat=excluded.lat, lon=excluded.lon, hours=excluded.hours, hours_confirmed_on_source=excluded.hours_confirmed_on_source,
         has_ac=excluded.has_ac, phone=excluded.phone, source_url=excluded.source_url, last_verified_at=excluded.last_verified_at,
         access_level=excluded.access_level, access_notes=excluded.access_notes, requires_id=excluded.requires_id,
         has_fee=excluded.has_fee, verification=excluded.verification, conflicts=excluded.conflicts,
         evidence=excluded.evidence, source_urls=excluded.source_urls`,
      [s.name, s.kind, s.tier, s.confidence, s.address, s.zip, s.lat, s.lon, JSON.stringify(s.hours), s.hours_confirmed_on_source,
       s.has_ac, s.has_filtration, s.capacity_est, s.phone, s.source_url, s.last_verified_at,
       x.access_level ?? "unknown", x.access_notes ?? null, x.requires_id ?? null, x.has_fee ?? null,
       VERIFICATION[x.verification] ?? "single_source", JSON.stringify(x.conflicts ?? []), x.evidence ?? null,
       x.sources ?? [], x.maps_place_id ?? null],
    );
  }
  await db.query("commit");

  // 3. Page version history (replace: the log file is the source of truth).
  const log = (await read("./data/history.jsonl").catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  await db.query("begin");
  await db.query("delete from source_page_versions");
  for (const v of log) {
    await db.query(
      `insert into source_page_versions (url, fetched_at, status, ok, content_hash, chars, error, blocked_by_policy)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [v.url, v.fetched_at, v.status, v.ok, v.content_hash, v.chars, v.error ?? null, !!v.blocked_by_policy],
    );
  }
  await db.query("commit");

  // 4. Verify by reading back.
  const q = async (sql: string) => (await db.query(sql)).rows;
  console.log("sites loaded:", (await q("select count(*)::int n from sites"))[0].n);
  console.log("by verification:", await q("select verification, count(*)::int n from sites group by 1 order by 2 desc"));
  console.log("by access:", await q("select access_level, count(*)::int n from sites group by 1 order by 2 desc"));
  console.log("page versions:", (await q("select count(*)::int n from source_page_versions"))[0].n);
  await db.end();
}

main().catch((e) => { console.error("load failed:", e.message); process.exit(1); });

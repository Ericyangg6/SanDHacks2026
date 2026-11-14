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
  confirmed: "confirmed", conflict: "conflict", maps_only: "single_source", single_hours_source: "single_source",
  web_only: "web_only", listed_only: "single_source",
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

  // 1a. Keep this branch in step with the team schema (data/schema/schema.sql), idempotently. Changes by M4:
  //     two new channels and subscribers.alert_channel. ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
  await db.query("alter type channel add value if not exists 'messenger'");
  await db.query("alter type channel add value if not exists 'whatsapp'");
  await db.query(`alter table subscribers add column if not exists alert_channel text
    check (alert_channel in ('sms', 'whatsapp'))`);

  // 1b. Extra columns added after the first proposal draft (idempotent).
  await db.query(`alter table sites
    add column if not exists pet_policy   text,
    add column if not exists official_name text,
    add column if not exists ac_source    text`); // official_program | site_page | reviews (null = unknown)

  // 2. Load sites in seed order (official first, then best-verified, then by zip). The seed is the source of truth,
  //    so this branch is rebuilt from it on every run; ids match data/seed/sites.json.
  const sites = JSON.parse(await read("../data/seed/sites.json"));
  const extras = JSON.parse(await read("../data/seed/sites.extras.json"));
  await db.query("begin");
  await db.query("truncate sites restart identity cascade");
  for (const s of sites) {
    const x = extras[s.id] ?? {};
    await db.query(
      `insert into sites (id, name, kind, tier, confidence, address, zip, lat, lon, hours, hours_confirmed_on_source,
         has_ac, has_filtration, capacity_est, phone, source_url, last_verified_at,
         access_level, access_notes, requires_id, has_fee, verification, conflicts, evidence, source_urls, maps_place_id,
         pet_policy, official_name, ac_source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
      [s.id, s.name, s.kind, s.tier, s.confidence, s.address, s.zip, s.lat, s.lon, JSON.stringify(s.hours), s.hours_confirmed_on_source,
       s.has_ac, s.has_filtration, s.capacity_est, s.phone, s.source_url, s.last_verified_at,
       x.access_level ?? "unknown", x.access_notes ?? null, x.requires_id ?? null, x.has_fee ?? null,
       VERIFICATION[x.verification] ?? "single_source", JSON.stringify(x.conflicts ?? []), x.evidence ?? null,
       x.sources ?? [], x.maps_place_id ?? null, x.pet_policy ?? null, x.official_name ?? null, x.ac_from ?? null],
    );
  }
  await db.query(`select setval(pg_get_serial_sequence('sites','id'), (select coalesce(max(id),1) from sites))`);
  await db.query("commit");

  // 2b. NWS readings (contract table `readings`) and the ZIP gap analysis (proposed table `zip_gap`).
  await db.query(`create table if not exists zip_gap (
    zip text primary key, name text, population int, age65plus int, households_no_vehicle int, below_poverty int,
    residents_at_risk int, sites_within_5km int, official_within_5km int, nearest_site_km real, nearest_site text,
    forecast_zone text, peak_temp_f real, peak_heat_index real, peak_time timestamptz, hours_90f_plus_72h int,
    heat_factor real, gap_score int, scenario_heat_index real, generated_at timestamptz)`);
  const gap = JSON.parse(await read("../data/seed/zip_gap.json").catch(() => "null"));
  if (gap?.zips) {
    await db.query("begin");
    await db.query("truncate zip_gap");
    for (const z of gap.zips) {
      await db.query(
        `insert into zip_gap values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [z.zip, z.name, z.population, z.age65plus, z.households_no_vehicle, z.below_poverty, z.residents_at_risk, z.sites_within_5km,
         z.official_within_5km, z.nearest_site_km, z.nearest_site, z.forecast_zone, z.peak_temp_f, z.peak_heat_index, z.peak_time,
         z.hours_90f_plus_72h, z.heat_factor, z.gap_score, gap.scenario_heat_index, gap.generated_at]);
    }
    await db.query("commit");
  }
  const readings = JSON.parse(await read("../data/seed/readings.json").catch(() => "[]"));
  await db.query("begin");
  await db.query("delete from readings where source = 'nws'"); // replace our own rows only; never touch mock or other sources
  for (const r of readings) await db.query("insert into readings (time, zip, temp_f, heat_index, aqi, source) values ($1,$2,$3,$4,$5,$6)", [r.time, r.zip, r.temp_f, r.heat_index, r.aqi, r.source]);
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
  console.log("by tier:", await q("select tier, count(*)::int n from sites group by 1 order by 2 desc"));
  console.log("by kind:", await q("select kind, count(*)::int n from sites group by 1 order by 2 desc"));
  console.log("zips:", (await q("select count(distinct zip)::int n from sites"))[0].n, "| capacity known:", (await q("select count(capacity_est)::int n from sites"))[0].n, "| ac known:", (await q("select count(has_ac)::int n from sites"))[0].n);
  console.log("by access:", await q("select access_level, count(*)::int n from sites group by 1 order by 2 desc"));
  console.log("zip_gap rows:", (await q("select count(*)::int n from zip_gap"))[0].n, "| nws readings:", (await q("select count(*)::int n from readings where source='nws'"))[0].n);
  console.log("page versions:", (await q("select count(*)::int n from source_page_versions"))[0].n);
  await db.end();
}

main().catch((e) => { console.error("load failed:", e.message); process.exit(1); });

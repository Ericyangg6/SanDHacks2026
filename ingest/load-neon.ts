// Load the seed into Neon.
//   node --env-file=.env ingest/load-neon.ts                 the non-production branch (NEON_INGEST_DEV_URL)
//   node --env-file=.env ingest/load-neon.ts --prod --yes    PRODUCTION (NEON_DATABASE_URL_UNPOOLED)
//
// Safe to run repeatedly, in either target:
//   * applies data/schema/migrations/*.sql first (idempotent, additive)
//   * sites are UPSERTED by their stable key (external_key); existing ids never change and sites are never deleted,
//     so calls.site_id, SMS links and anything else that references a site keep working
//   * rows that predate external_key are matched to the seed by id AND name, and refused if anything does not match
//   * only M2's own tables are replaced wholesale (zip_gap, source_page_versions) plus readings WHERE source = 'nws'
//   * never touches calls, messages, subscribers or alerts, and verifies their row counts did not change
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const { Client } = createRequire(import.meta.url)("pg");
const PROD = process.argv.includes("--prod");
const clean = (u?: string) => u?.replace(/^"|"$/g, "");
const prodUrl = clean(process.env.NEON_DATABASE_URL_UNPOOLED ?? process.env.NEON_DATABASE_URL);
const devUrl = clean(process.env.NEON_INGEST_DEV_URL);
const host = (u: string) => new URL(u).hostname.replace("-pooler", "");

if (PROD && !process.argv.includes("--yes")) throw new Error("Production load needs --prod --yes");
const url = PROD ? prodUrl : devUrl;
if (!url) throw new Error(PROD ? "Set NEON_DATABASE_URL_UNPOOLED" : "Set NEON_INGEST_DEV_URL (a non-production Neon branch)");
if (!PROD && prodUrl && host(url) === host(prodUrl)) throw new Error("NEON_INGEST_DEV_URL points at production; use --prod --yes if that is what you mean.");

const read = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");
const VERIFICATION: Record<string, string> = {
  confirmed: "confirmed", conflict: "conflict", maps_only: "single_source", single_hours_source: "single_source",
  web_only: "web_only", listed_only: "single_source",
};

async function main() {
  const db = new Client({ connectionString: url });
  await db.connect();
  const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
  console.log(`target: ${PROD ? "PRODUCTION" : "dev branch"} (${host(url!).split(".")[0]})`);

  // Rows other people write: must be identical before and after.
  const guard = async () => Object.fromEntries(await Promise.all(["calls", "messages", "subscribers", "alerts"].map(async (t) => [t, (await q(`select count(*)::int n from ${t}`))[0].n])));
  const before = await guard();
  const sites = JSON.parse(await read("../data/seed/sites.json"));
  const extras = JSON.parse(await read("../data/seed/sites.extras.json"));

  // 1. migrations (idempotent)
  const dir = new URL("../data/schema/migrations/", import.meta.url);
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(await readFile(new URL(f, dir), "utf8"));
    console.log(`migration applied: ${f}`);
  }
  if (!PROD) { // keep the dev branch in step with M4's channel changes (production already has them)
    await db.query("alter type channel add value if not exists 'messenger'");
    await db.query("alter type channel add value if not exists 'whatsapp'");
    await db.query("alter table subscribers add column if not exists alert_channel text check (alert_channel in ('sms', 'whatsapp'))");
  }

  // 2a. rows without a stable key: match them to the seed by id AND name, never by guesswork
  const legacy = await q("select id, name from sites where external_key is null");
  if (legacy.length) {
    const seedById = new Map<number, any>(sites.map((s: any) => [s.id, s]));
    const unmatched = legacy.filter((r: any) => seedById.get(r.id)?.name !== r.name);
    if (unmatched.length) {
      if (PROD) throw new Error(`${unmatched.length} production sites do not match the seed by id+name (e.g. id ${unmatched[0].id} "${unmatched[0].name}"); refusing to guess.`);
      await db.query("truncate sites restart identity cascade"); // dev branch only
    } else {
      await db.query("begin");
      for (const r of legacy) await db.query("update sites set external_key = $1 where id = $2 and external_key is null", [extras[r.id].external_key, r.id]);
      await db.query("commit");
      console.log(`backfilled external_key on ${legacy.length} existing sites (matched by id and name)`);
    }
  }

  // 2b. upsert by external_key
  await db.query("begin");
  for (const s of sites) {
    const x = extras[s.id] ?? {};
    const placeId = x.external_key?.includes("#") ? null : x.maps_place_id ?? null; // a '#n' duplicate must not reuse the place id
    await db.query(
      `insert into sites (id, name, kind, tier, confidence, address, zip, lat, lon, hours, hours_confirmed_on_source,
         has_ac, has_filtration, capacity_est, phone, source_url, last_verified_at,
         access_level, access_notes, requires_id, has_fee, verification, conflicts, evidence, source_urls, maps_place_id,
         external_key, pet_policy, official_name, ac_source, category)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
       on conflict (external_key) do update set
         name=excluded.name, kind=excluded.kind, tier=excluded.tier, confidence=excluded.confidence, address=excluded.address,
         zip=excluded.zip, lat=excluded.lat, lon=excluded.lon, hours=excluded.hours,
         hours_confirmed_on_source=excluded.hours_confirmed_on_source, has_ac=excluded.has_ac, has_filtration=excluded.has_filtration,
         capacity_est=excluded.capacity_est, phone=excluded.phone, source_url=excluded.source_url,
         last_verified_at=excluded.last_verified_at, access_level=excluded.access_level, access_notes=excluded.access_notes,
         requires_id=excluded.requires_id, has_fee=excluded.has_fee, verification=excluded.verification,
         conflicts=excluded.conflicts, evidence=excluded.evidence, source_urls=excluded.source_urls,
         maps_place_id=excluded.maps_place_id, pet_policy=excluded.pet_policy, official_name=excluded.official_name,
         ac_source=excluded.ac_source, category=excluded.category`,
      [s.id, s.name, s.kind, s.tier, s.confidence, s.address, s.zip, s.lat, s.lon, JSON.stringify(s.hours), s.hours_confirmed_on_source,
       s.has_ac, s.has_filtration, s.capacity_est, s.phone, s.source_url, s.last_verified_at,
       x.access_level ?? "unknown", x.access_notes ?? null, x.requires_id ?? null, x.has_fee ?? null,
       VERIFICATION[x.verification] ?? "single_source", JSON.stringify(x.conflicts ?? []), x.evidence ?? null,
       x.sources ?? [], placeId, x.external_key, x.pet_policy ?? null, x.official_name ?? null, x.ac_from ?? null, x.category ?? null],
    );
  }
  await db.query(`select setval(pg_get_serial_sequence('sites','id'), (select coalesce(max(id),1) from sites))`);
  await db.query("commit");

  // 3. M2's own tables
  const gap = JSON.parse(await read("../data/seed/zip_gap.json").catch(() => "null"));
  if (gap?.zips) {
    await db.query("begin");
    await db.query("truncate zip_gap");
    for (const z of gap.zips) {
      await db.query(`insert into zip_gap values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [z.zip, z.name, z.population, z.age65plus, z.households_no_vehicle, z.below_poverty, z.residents_at_risk, z.sites_within_5km,
         z.official_within_5km, z.nearest_site_km, z.nearest_site, z.forecast_zone, z.peak_temp_f, z.peak_heat_index, z.peak_time,
         z.hours_90f_plus_72h, z.heat_factor, z.gap_score, gap.scenario_heat_index, gap.generated_at]);
    }
    await db.query("commit");
  }
  const readings = JSON.parse(await read("../data/seed/readings.json").catch(() => "[]"));
  await db.query("begin");
  await db.query("delete from readings where source = 'nws'"); // our own rows only; never mock or other sources
  for (const r of readings) await db.query("insert into readings (time, zip, temp_f, heat_index, aqi, source) values ($1,$2,$3,$4,$5,$6)", [r.time, r.zip, r.temp_f, r.heat_index, r.aqi, r.source]);
  await db.query("commit");
  const log = (await read("./data/history.jsonl").catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  await db.query("begin");
  await db.query("truncate source_page_versions");
  for (const v of log) {
    await db.query(`insert into source_page_versions (url, fetched_at, status, ok, content_hash, chars, error, blocked_by_policy) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [v.url, v.fetched_at, v.status, v.ok, v.content_hash, v.chars, v.error ?? null, !!v.blocked_by_policy]);
  }
  await db.query("commit");

  // 3b. location data for find_sites, review signals, news (all M2-owned; replaced wholesale)
  const landmarks: [string, number, number, string, number][] = JSON.parse(await read("../data/seed/landmarks.json").catch(() => "[]"));
  if (landmarks.length) {
    await db.query("begin");
    await db.query("truncate landmarks restart identity");
    for (let i = 0; i < landmarks.length; i += 2000) {
      const part = landmarks.slice(i, i + 2000);
      await db.query("insert into landmarks (name, lat, lon, kind, weight) select * from unnest($1::text[], $2::float8[], $3::float8[], $4::text[], $5::int[])",
        [part.map((r) => r[0]), part.map((r) => r[1]), part.map((r) => r[2]), part.map((r) => r[3]), part.map((r) => r[4])]);
    }
    await db.query("commit");
  }
  const pl = JSON.parse(await read("../data/seed/places.json").catch(() => "null"));
  if (pl) {
    const rows: [string, string, number, number][] = [
      ...Object.entries<any>(pl.zips).map(([k, v]) => ["zip", k, v.lat, v.lon] as [string, string, number, number]),
      ...Object.entries<any>(pl.places).map(([k, v]) => ["town", k, v.lat, v.lon] as [string, string, number, number]),
    ];
    await db.query("begin");
    await db.query("truncate places");
    await db.query("insert into places (kind, key, lat, lon) select * from unnest($1::text[], $2::text[], $3::float8[], $4::float8[])",
      [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2]), rows.map((r) => r[3])]);
    await db.query("commit");
  }
  const signals: Record<string, any> = JSON.parse(await read("./data/review_signals.json").catch(() => "{}"));
  await db.query("begin");
  await db.query("truncate site_review_signals");
  for (const g of Object.values(signals)) {
    await db.query(
      `insert into site_review_signals (maps_place_id, site_id, reviews_scanned, window_days, ac_positive, ac_negative, crowded, spacious, quotes, scanned_at)
       values ($1, (select id from sites where maps_place_id = $1), $2,$3,$4,$5,$6,$7,$8,$9)`,
      [g.place_id, g.reviews_scanned, g.window_days, g.ac_positive, g.ac_negative, g.crowded, g.spacious, JSON.stringify(g.quotes ?? []), g.scanned_at]);
  }
  await db.query("commit");
  const news: any[] = JSON.parse(await read("../data/seed/news.json").catch(() => "[]"));
  await db.query("begin");
  await db.query("truncate news_items");
  for (const n of news) await db.query("insert into news_items (link, title, source, date_text) values ($1,$2,$3,$4) on conflict (link) do nothing", [n.link, n.title, n.source, n.date]);
  await db.query("commit");

  // 4. verify
  const after = await guard();
  const same = JSON.stringify(before) === JSON.stringify(after);
  console.log(`other teams' rows before/after: ${JSON.stringify(before)} → ${JSON.stringify(after)} ${same ? "(unchanged ✓)" : "(CHANGED ✗)"}`);
  console.log("sites:", (await q("select count(*)::int n from sites"))[0].n, "| max id", (await q("select max(id)::int m from sites"))[0].m, "| with external_key", (await q("select count(external_key)::int n from sites"))[0].n);
  console.log("by tier:", JSON.stringify(await q("select tier, count(*)::int n from sites group by 1 order by 2 desc")));
  console.log("zip_gap rows:", (await q("select count(*)::int n from zip_gap"))[0].n, "| nws readings:", (await q("select count(*)::int n from readings where source='nws'"))[0].n, "| page versions:", (await q("select count(*)::int n from source_page_versions"))[0].n);
  console.log("landmarks:", (await q("select count(*)::int n from landmarks"))[0].n, "| places:", (await q("select count(*)::int n from places"))[0].n,
    "| review signals:", (await q("select count(*)::int n from site_review_signals"))[0].n, `(linked to a site: ${(await q("select count(site_id)::int n from site_review_signals"))[0].n})`,
    "| news:", (await q("select count(*)::int n from news_items"))[0].n);
  await db.end();
  if (!same) process.exit(3);
}

main().catch((e) => { console.error("load failed:", e.message); process.exit(1); });

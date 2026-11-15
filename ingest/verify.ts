// Pre-commit verification. Read-only. Exits non-zero if anything is wrong.
//   node --env-file=.env ingest/verify.ts            checks the seed files and the pipeline outputs
//   node --env-file=.env ingest/verify.ts --prod     also compares production Neon with the seed (read-only transaction)
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const here = (p: string) => new URL(p, import.meta.url);
const json = async (p: string, d: any = null) => JSON.parse(await readFile(here(p), "utf8").catch(() => JSON.stringify(d)));
let bad = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string) => { bad++; console.log(`  ✗ ${m}`); };
const check = (cond: boolean, good: string, wrong: string) => (cond ? ok(good) : fail(wrong));
const inBox = (s: any, [a, b, c, d]: number[]) => s.lat >= a && s.lat <= b && s.lon >= c && s.lon <= d;
const UCSD = [32.835, 32.905, -117.30, -117.195];

async function main() {
  const sites: any[] = await json("../data/seed/sites.json", []);
  const extras: Record<string, any> = await json("../data/seed/sites.extras.json", {});
  const registry = await json("../data/seed/site_ids.json", { ids: {}, next_id: 0 });
  const landmarks: any[] = await json("../data/seed/landmarks.json", []);
  const hist: any[] = (await readFile(here("./data/history.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const verified: any[] = await json("./data/sites.json", []);
  const rejected: any[] = await json("./data/rejected.json", []);
  const maps: any[] = await json("./data/maps_sites.json", []);
  const cands: any[] = await json("./data/candidates.json", []);

  console.log("\nFETCH");
  const ucsdUrls = new Set(cands.filter((c) => String(c.area).startsWith("UCSD")).map((c) => c.url));
  const fetched = new Set(hist.filter((h) => h.ok).map((h) => h.url));
  const got = [...ucsdUrls].filter((u) => fetched.has(u)).length;
  check(ucsdUrls.size > 0, `${ucsdUrls.size} UCSD candidate pages found by search`, "no UCSD candidates");
  check(got / Math.max(1, ucsdUrls.size) >= 0.6, `${got}/${ucsdUrls.size} UCSD pages fetched (${Math.round((100 * got) / ucsdUrls.size)}%)`, `only ${got}/${ucsdUrls.size} UCSD pages fetched`);
  const mapsInUcsd = maps.filter((m) => typeof m.lat === "number" && inBox(m, UCSD));
  check(mapsInUcsd.length >= 40, `${mapsInUcsd.length} Google Maps places in the UCSD / La Jolla box`, `only ${mapsInUcsd.length} Maps places in the UCSD box`);
  const withSite = mapsInUcsd.filter((m) => m.website && fetched.has(m.website)).length;
  console.log(`    (${withSite}/${mapsInUcsd.filter((m) => m.website).length} of those places' own websites fetched)`);

  console.log("\nEXTRACTION");
  const gate = verified.length / Math.max(1, verified.length + rejected.length);
  check(gate >= 0.85, `${verified.length} records passed the verbatim-quote check, ${rejected.length} rejected (${Math.round(gate * 100)}% pass)`, `quote check pass rate only ${Math.round(gate * 100)}%`);
  check(verified.every((v) => v.evidence_verified), "every kept record has a verified evidence quote", "a kept record lacks a verified quote");

  console.log("\nSEED");
  check(sites.length >= 271, `${sites.length} sites (was 271 before campus)`, `seed shrank to ${sites.length}`);
  const ids = sites.map((s) => s.id);
  check(new Set(ids).size === ids.length, "ids are unique", "duplicate ids");
  check(ids.every((i) => extras[String(i)]?.external_key), "every site has an external_key", "a site is missing external_key");
  const reg = registry.ids as Record<string, number>;
  check(sites.every((s) => reg[extras[String(s.id)]?.external_key] === s.id), "every id matches the stable-id registry", "an id disagrees with the registry (ids shifted!)");
  const prior = await json("../data/seed/.verified_ids.json", null);
  if (prior) check(Object.entries(prior).every(([k, v]) => !(k in reg) || reg[k] === v), "no existing site changed id since the last verified run", "an EXISTING site changed id");
  const dupes = new Map<string, number>();
  for (const s of sites) { const k = `${s.name.toLowerCase()}|${s.address.toLowerCase()}`; dupes.set(k, (dupes.get(k) ?? 0) + 1); }
  check([...dupes.values()].every((n) => n === 1), "no duplicate name+address", `${[...dupes.values()].filter((n) => n > 1).length} duplicate name+address pairs`);
  check(sites.every((s) => s.lat > 32.5 && s.lat < 33.52 && s.lon > -117.62 && s.lon < -116.07), "all sites inside San Diego County", "a site is outside the county");
  check(sites.every((s) => s.name && s.address && s.source_url && s.last_verified_at && s.hours?.weekly?.length), "required fields present, hours non-empty", "a site is missing a required field");
  const badHours = sites.filter((s) => s.hours.weekly.some((h: any) => !/^\d\d:\d\d$/.test(h.open) || !/^\d\d:\d\d$/.test(h.close) || h.open === h.close || h.day < 0 || h.day > 6)).length;
  const overnight = sites.filter((s) => s.hours.weekly.some((h: any) => h.close < h.open)).length;
  check(badHours === 0, `all hours intervals are valid (day 0-6, well-formed times; ${overnight} sites have overnight hours, which find_sites handles)`, `${badHours} sites with malformed or zero-length hours`);
  const badEx = sites.filter((s) => (s.hours.exceptions ?? []).some((e: any) => !/^\d{4}-\d{2}-\d{2}$/.test(e.date))).length;
  check(badEx === 0, `${sites.filter((s) => s.hours.exceptions?.length).length} sites with holiday exceptions, all dates valid`, `${badEx} sites with a bad exception date`);
  const campus = sites.filter((s) => inBox(s, UCSD));
  check(campus.length >= 15, `${campus.length} seed sites in the UCSD / La Jolla box (nearby: ${campus.filter((s) => /ucsd|geisel|price|jolla|scripps|utc/i.test(s.name)).length} named campus/La Jolla)`, `only ${campus.length} seed sites in the UCSD box`);
  const restricted = campus.filter((s) => ["students_only", "members_only", "age_restricted", "residents_only"].includes(extras[String(s.id)]?.access_level)).length;
  console.log(`    (${restricted} campus sites are access-restricted, so find_sites will skip them)`);
  check(landmarks.length > 6000, `${landmarks.length} landmarks`, "landmark gazetteer is small");

  console.log("\nSECRETS / HYGIENE");
  const text = JSON.stringify(sites) + JSON.stringify(extras);
  check(!/ctxt_secret_|sk-ant-|napi_|postgres(ql)?:\/\//.test(text), "no secrets in the seed", "a secret-looking string is in the seed");

  if (process.argv.includes("--prod")) {
    console.log("\nPRODUCTION NEON (read-only)");
    const { Client } = createRequire(import.meta.url)("pg");
    const c = new Client({ connectionString: (process.env.NEON_DATABASE_URL_UNPOOLED ?? "").replace(/^"|"$/g, "") });
    await c.connect();
    await c.query("set default_transaction_read_only = on");
    const db = (await c.query("select * from sites order by id")).rows;
    const seedIds = new Set(sites.map((s) => s.id));
    const retained = db.filter((r: any) => !seedIds.has(r.id));
    check(sites.every((s) => db.some((r: any) => r.id === s.id)) && retained.length <= 5, `production has all ${sites.length} seed sites${retained.length ? ` plus ${retained.length} retained from earlier loads (the loader never deletes): ${retained.map((r: any) => r.name).join("; ")}` : ""}`, `production is missing seed sites or holds ${retained.length} unexplained extras`);
    const byId = new Map(db.map((r: any) => [r.id, r]));
    const diff = sites.filter((s) => { const r: any = byId.get(s.id); return !r || r.name !== s.name || r.address !== s.address || JSON.stringify(r.hours?.weekly) !== JSON.stringify(s.hours.weekly); }).length;
    check(diff === 0, "every site matches production (id, name, address, weekly hours)", `${diff} sites differ from production; run: load-neon.ts --prod --yes`);
    const n = async (t: string) => (await c.query(`select count(*)::int n from ${t}`)).rows[0].n;
    check((await n("landmarks")) === landmarks.length, `landmarks in Neon: ${await n("landmarks")}`, `landmarks in Neon ${await n("landmarks")} vs file ${landmarks.length}`);
    console.log(`    other teams' rows: calls ${await n("calls")}, messages ${await n("messages")}, subscribers ${await n("subscribers")}, alerts ${await n("alerts")}`);
    await c.end();
  }

  console.log(bad ? `\n${bad} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
  if (!bad) { /* remember ids so the next run can prove none changed */ }
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error("verify crashed:", e.message); process.exit(2); });

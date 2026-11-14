// Recover Google Maps results from Bright Data: downloads every FINISHED snapshot of the Maps dataset created in the
// last N hours and merges it into maps_sites.json. Use it when a long run was interrupted or timed out.
//   node --env-file=.env ingest/maps-recover.ts [hours=12]
import { ingestRows } from "./maps.ts";

const TOKEN = process.env.BRIGHTDATA_API_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}` };
const HOURS = Number(process.argv[2] ?? 12);

async function main() {
  const list: any[] = await (await fetch("https://api.brightdata.com/datasets/v3/snapshots?dataset_id=gd_m8ebnr0q2qlklc02fz&status=ready", { headers: H })).json();
  const since = Date.now() - HOURS * 3600_000;
  const recent = list.filter((s) => Date.parse(s.created) >= since);
  console.log(`${recent.length} finished snapshots in the last ${HOURS}h`);
  let total = 0;
  for (const s of recent) {
    const rows = await (await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${s.id}?format=json`, { headers: H })).json();
    if (!Array.isArray(rows)) { console.log(`  ${s.id}: not downloadable yet`); continue; }
    total += rows.length;
    console.log(`  ${s.id}: ${rows.length} rows`);
    await ingestRows(rows);
  }
  console.log(`recovered ${total} rows`);
}

main();

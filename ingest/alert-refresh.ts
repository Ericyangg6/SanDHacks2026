// NWS alert -> re-crawl workflow. When the National Weather Service issues a heat or air-quality alert for a forecast
// zone, re-fetch the pages of every site in the affected ZIPs and report what changed (extended hours, closures,
// pop-up notices), so callers get hours that are hours old, not months old.
//   node --env-file=.env ingest/alert-refresh.ts            real alerts only
//   node --env-file=.env ingest/alert-refresh.ts --mock     pretend an Extreme Heat Warning fired (demo)
//   node --env-file=.env ingest/alert-refresh.ts --mock CAZ050,CAZ043
import { readFile, writeFile } from "node:fs/promises";
import { fetchSanDiegoAlerts, mockHeatAlert, SD_ZONES } from "../apps/api/src/lib/nws.ts";
import { fetchPage } from "./brightdata.ts";
import { record, type Change } from "./history.ts";

const mock = process.argv.includes("--mock");
const zoneArg = process.argv.find((a) => /^CAZ\d+/.test(a));

async function main() {
  const alerts = mock ? [mockHeatAlert(zoneArg ? zoneArg.split(",") : ["CAZ043", "CAZ050"])] : await fetchSanDiegoAlerts();
  if (!alerts.length) { console.log("No active heat or air-quality alerts for San Diego County. Nothing to refresh."); return; }
  for (const a of alerts) console.log(`${a.mock ? "MOCK " : ""}ALERT: ${a.event} | zones ${a.zones.join(", ")} (${a.zones.map((z) => (SD_ZONES as any)[z] ?? z).join(", ")})`);

  const zones = new Set(alerts.flatMap((a) => a.zones));
  const gap = JSON.parse(await readFile(new URL("../data/seed/zip_gap.json", import.meta.url), "utf8")).zips as any[];
  const zips = new Set(gap.filter((z) => zones.has(z.forecast_zone)).map((z) => z.zip));
  const sites: any[] = JSON.parse(await readFile(new URL("../data/seed/sites.json", import.meta.url), "utf8"));
  const affected = sites.filter((s) => s.zip && zips.has(s.zip));
  const urls = [...new Set(affected.map((s) => s.source_url).filter((u: string) => /^https?:/.test(u) && !/google\.com\/maps/.test(u)))];
  console.log(`${zips.size} ZIPs in alert zones → ${affected.length} sites → ${urls.length} pages to refresh`);

  const changes: Change[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Number(process.env.FETCH_CONCURRENCY ?? 5) }, async () => {
    while (next < urls.length) {
      const u = urls[next++];
      try { const r = await fetchPage(u, { fresh: true }); changes.push(await record(u, r)); } catch { /* counted below */ }
    }
  }));

  const n = (k: string) => changes.filter((c) => c.kind === k).length;
  console.log(`\nrefreshed ${changes.length}/${urls.length}: ${n("changed")} changed, ${n("unchanged")} unchanged, ${n("new")} new, ${n("failed")} failed`);
  for (const c of changes.filter((c) => c.kind === "changed").slice(0, 10)) {
    console.log(`\nCHANGED ${c.url}`);
    c.added_lines.slice(0, 3).forEach((l) => console.log(`  + ${l.slice(0, 140)}`));
    c.removed_lines.slice(0, 3).forEach((l) => console.log(`  - ${l.slice(0, 140)}`));
  }
  await writeFile(new URL("../data/seed/alert_refresh.json", import.meta.url), JSON.stringify({
    at: new Date().toISOString(), mock, alerts: alerts.map((a) => ({ event: a.event, zones: a.zones, headline: a.headline })),
    zips: [...zips], sites_affected: affected.length, pages_refreshed: changes.length,
    changed: changes.filter((c) => c.kind === "changed").map((c) => ({ url: c.url, added: c.added_lines.slice(0, 10), removed: c.removed_lines.slice(0, 10) })),
  }, null, 1) + "\n");
  console.log("\n→ data/seed/alert_refresh.json  (re-run extract → merge → to-seed to apply changed hours)");
}

main();

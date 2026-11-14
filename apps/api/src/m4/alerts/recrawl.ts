// Asks M2 to re-crawl sites in these zips before we text anyone. M2 owns the crawler; the mechanism is not agreed
// yet, so for now this only logs the request and resolves at once: texts go out against the sites as they were last
// verified, and find_sites already drops sites whose last_verified_at is stale.
// TODO: Agree with M2: await a function they export, POST to an endpoint they run, or nothing here at all because
//       M2 watches for new alerts rows (schema.sql lists M2 as a reader of alerts). Then decide whether a slow or
//       failed re-crawl holds the texts back, and cap the wait with a timeout either way.
export async function requestRecrawl(zips: string[]): Promise<void> {
  if (zips.length === 0) return;
  console.info(`[m4] re-crawl requested for ${zips.length} zips (not wired to M2 yet, nothing was crawled)`);
}

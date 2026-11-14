import { notImplemented } from '../todo';

// Asks M2 to re-crawl sites in these zips before we text anyone. M2 owns the crawler; the mechanism is not agreed yet.
export async function requestRecrawl(zips: string[]): Promise<void> {
  // TODO: 1. Agree the mechanism with M2. Candidates: await a function they export, POST to an endpoint they run,
  //          or nothing here at all because M2 watches for new alerts rows (schema.sql lists M2 as a reader of
  //          alerts for the re-crawl trigger).
  // TODO: 2. Agree what resolving means: "request accepted" or "crawl finished". Dispatch starts as soon as this
  //          resolves, so with "accepted" the texts go out against sites as they were last verified.
  // TODO: 3. Decide whether a slow or failed re-crawl holds back the texts, and cap the wait with a timeout either
  //          way. find_sites already drops sites whose last_verified_at is stale.
  // TODO: 4. Return early when zips is empty.
  return notImplemented('recrawl.requestRecrawl');
}

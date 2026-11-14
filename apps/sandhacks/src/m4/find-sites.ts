import { notImplemented } from './todo';
import type { FindSitesInput, FindSitesOutput } from './types';

// M2 owns find_sites. This is the one place M4 calls it from: swap the body for their implementation
// once it lands, and do not reimplement the ranking here. It writes nothing; the caller logs the calls row.
export async function findSites(input: FindSitesInput): Promise<FindSitesOutput> {
  return notImplemented('findSites: waiting on M2');
}

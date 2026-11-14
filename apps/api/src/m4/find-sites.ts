import { findSites as sharedFindSites } from '../shared/find-sites';
import type { FindSitesInput, FindSitesOutput } from './types';

// M2 owns find_sites. This is the one place M4 calls it from, and it only forwards to the team's shared module,
// which the voice line uses too. Do not reimplement the ranking here. It writes nothing; the caller logs the calls row.
// Until M2 ships, the shared module is a stub that returns the same two El Cajon sites for any location.
export async function findSites(input: FindSitesInput): Promise<FindSitesOutput> {
  return sharedFindSites(input);
}

import { env } from '../env';

// The person's name from their Facebook profile, through Meta's Graph API (the Messenger User Profile API):
//   GET https://graph.facebook.com/<psid>?fields=first_name,last_name
// Twilio's Messenger webhook carries no name, so this needs a Page access token for the Shadoes Page
// (FACEBOOK_PAGE_ACCESS_TOKEN). Without one, or when Facebook does not answer, the name is simply unknown.

const GRAPH_TIMEOUT_MS = 3_000;
const MAX_NAME_LENGTH = 80;

// "First Last", or null. Never throws, and never logs the id, the token or the name.
export async function fetchMessengerName(psid: string): Promise<string | null> {
  const token = env.facebookPageAccessToken();
  if (!token) return null;

  const url = new URL(`https://graph.facebook.com/${encodeURIComponent(psid)}`);
  url.searchParams.set('fields', 'first_name,last_name');
  url.searchParams.set('access_token', token);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
    const payload = (await response.json().catch(() => null)) as {
      first_name?: unknown;
      last_name?: unknown;
      error?: { code?: unknown };
    } | null;
    if (!response.ok) {
      const code = typeof payload?.error?.code === 'number' ? ` (Graph error ${payload.error.code})` : '';
      console.warn(`[m4] Facebook profile lookup failed: HTTP ${response.status}${code}`);
      return null;
    }
    const name = [payload?.first_name, payload?.last_name]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join(' ')
      .trim()
      .slice(0, MAX_NAME_LENGTH);
    return name || null;
  } catch (error) {
    console.warn(`[m4] Facebook profile lookup failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return null;
  }
}

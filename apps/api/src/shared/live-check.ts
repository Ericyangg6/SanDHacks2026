// Live closure check (Bright Data Web Unlocker) used at call time by find_sites.
// Before we recommend a site whose hours we have not confirmed on its own page, fetch that page once, hard-capped,
// and look for a same-day closure notice. Anything other than a clear closure (timeout, block, no key, empty page)
// returns 'unknown' and the caller keeps using the stored data. This never throws and never takes longer than the cap.
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_UNLOCKER_ZONE ?? 'shade_unlocker';
export const LIVE_CHECK_MS = Number(process.env.LIVE_CHECK_TIMEOUT_MS ?? 3000);
const FALLBACK_KEY = process.env.CONTEXT_DEV_API_KEY;
const TTL_MS = 10 * 60_000;

export interface LiveCheck {
  status: 'open_ok' | 'closed' | 'unknown';
  checked_at: string | null;   // ISO time of the live fetch; null when nothing was fetched
  quote: string | null;        // for 'closed': the sentence on the page that says so
  reason?: 'timeout' | 'blocked' | 'empty' | 'error' | 'disabled';
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// The ways a page writes today's date: "November 14", "Nov. 14", "11/14", "Nov 14th".
function dateForms(date: string): RegExp {
  const [, m, d] = date.split('-').map(Number);
  const full = MONTHS[m - 1], abbr = full.slice(0, 3);
  return new RegExp(`\\b(?:${full}|${abbr}\\.?)\\s+0?${d}(?:st|nd|rd|th)?\\b|\\b0?${m}/0?${d}\\b`, 'i');
}

// Pure and exported for tests. `today` is the local YYYY-MM-DD.
export function findClosure(markdown: string, today: string): string | null {
  const todayRe = dateForms(today);
  const sentences = markdown.split(/\n+/).flatMap((l) => l.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z])/));
  const closed = /\b(closed|closure|closing|cancell?ed|will not be open|not open)\b/i;
  const todayWords = /\b(today|this (?:afternoon|evening|morning)|tonight)\b/i;
  const ongoing = /\b(temporarily|permanently) closed\b/i;
  for (const s of sentences) {
    if (s.length < 8 || s.length > 400) continue;
    if (ongoing.test(s)) return s.trim();
    if (!closed.test(s)) continue;
    if (todayWords.test(s) || todayRe.test(s)) return s.trim();
  }
  return null;
}

const memo = new Map<string, { at: number; value: LiveCheck }>();

export async function liveCheck(url: string, today: string, timeoutMs = LIVE_CHECK_MS): Promise<LiveCheck> {
  if (!TOKEN) return { status: 'unknown', checked_at: null, quote: null, reason: 'disabled' };
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: LiveCheck;
  // Bright Data refuses every .gov domain by policy, so those pages go through the second fetcher (same cap, same checks).
  let gov = false;
  try { gov = /\.gov$/i.test(new URL(url).hostname); } catch { return { status: 'unknown', checked_at: null, quote: null, reason: 'error' }; }
  if (gov && !FALLBACK_KEY) return { status: 'unknown', checked_at: null, quote: null, reason: 'blocked' };
  try {
    const res = gov
      ? await fetch(`https://api.context.dev/v1/web/scrape/markdown?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${FALLBACK_KEY}` }, signal: AbortSignal.timeout(timeoutMs) })
      : await fetch('https://api.brightdata.com/request', {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ zone: ZONE, url, format: 'raw', data_format: 'markdown' }),
          signal: AbortSignal.timeout(timeoutMs),
        });
    const body = gov ? String((await res.json().catch(() => ({})) as any).markdown ?? '') : await res.text();
    if (!res.ok) value = { status: 'unknown', checked_at: null, quote: null, reason: 'blocked' };
    else if (body.trim().length < 200) value = { status: 'unknown', checked_at: null, quote: null, reason: 'empty' };
    else {
      const quote = findClosure(body, today);
      value = { status: quote ? 'closed' : 'open_ok', checked_at: new Date().toISOString(), quote };
    }
  } catch (e) {
    value = { status: 'unknown', checked_at: null, quote: null, reason: (e as Error).name === 'TimeoutError' ? 'timeout' : 'error' };
  }
  memo.set(url, { at: Date.now() - (value.reason === 'timeout' ? TTL_MS - 60_000 : 0), value }); // a timeout is remembered for 1 minute so a slow site cannot add its full wait to every call
  return value;
}

// Check several pages at once under ONE shared deadline, so the whole step costs at most `timeoutMs`.
export async function liveCheckMany(urls: string[], today: string, timeoutMs = LIVE_CHECK_MS): Promise<Map<string, LiveCheck>> {
  const out = new Map<string, LiveCheck>();
  await Promise.all([...new Set(urls)].map(async (u) => out.set(u, await liveCheck(u, today, timeoutMs))));
  return out;
}

// Thin Bright Data client (REST). Zero deps; run with Node 22+:
//   node --env-file=.env ingest/discover.ts
// Responses are cached on disk by request hash, so re-runs cost no credits
// (pass { fresh: true } to bypass the cache, e.g. when checking a page for changes).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const SERP_ZONE = process.env.BRIGHTDATA_SERP_ZONE ?? "mcp_serp";
const UNLOCKER_ZONE = process.env.BRIGHTDATA_UNLOCKER_ZONE ?? "shade_unlocker";
const CACHE_DIR = new URL("./cache/", import.meta.url);

if (!TOKEN) throw new Error("Set BRIGHTDATA_API_TOKEN in .env");

let requestCount = 0;
export const stats = () => ({ requests: requestCount });

const cacheFile = (key: string) =>
  new URL(createHash("sha1").update(key).digest("hex") + ".txt", CACHE_DIR);

async function readCache(key: string): Promise<string | null> {
  try {
    const hit = await readFile(cacheFile(key), "utf8");
    return hit.trim().length > 200 ? hit : null; // tiny/empty entries count as misses
  } catch {
    return null;
  }
}
async function writeCache(key: string, value: string) {
  if (value.trim().length <= 200) return;
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFile(key), value);
}

async function brd(body: object): Promise<string> {
  requestCount++;
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bright Data ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

export type SerpResult = { title: string; link: string; description: string };

/** Google search via the SERP API. Returns organic results with direct links only. */
export async function serp(query: string): Promise<SerpResult[]> {
  const key = `serp:${query}`;
  let raw = await readCache(key);
  let data: any = raw ? JSON.parse(raw) : null;
  for (let attempt = 0; !data && attempt < 3; attempt++) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&brd_json=1&gl=us&hl=en`;
    const text = await brd({ zone: SERP_ZONE, url, format: "raw" });
    try {
      data = JSON.parse(text); // transient empty bodies happen; retry instead of failing the query
      await writeCache(key, text);
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  if (!data) throw new Error("SERP returned no parseable response after 3 tries");
  return (data.organic ?? [])
    .map((r: any) => ({ title: r.title ?? "", link: directLink(r), description: r.description ?? "" }))
    .filter((r: SerpResult) => r.link);
}

// Google often returns opaque https://www.google.com/goto?url=... redirects. When the
// visible breadcrumb ("https://host › a › b") is complete (no "..."), rebuild the real
// URL from it; otherwise drop the result rather than guess.
function directLink(r: any): string {
  const link: string = r.link ?? "";
  if (!/google\.com\/goto|^\/goto/.test(link)) return link;
  const d: string = r.display_link ?? "";
  if (!d || d.includes("…") || d.includes("...")) return "";
  const [host, ...path] = d.split(" › ").map((s) => s.trim());
  return host.startsWith("http") ? [host, ...path].join("/") : "";
}

export type PageResult = {
  ok: boolean;
  status: number; // the TARGET site's real status, not Bright Data's
  markdown: string;
  error?: string; // x-brd-error header text, if any
  blocked_by_policy?: boolean; // e.g. .gov domains Bright Data refuses to fetch
  from_cache: boolean;
  attempts: number;
  via?: "fallback"; // set when the page did not come through Bright Data
};

/**
 * Fetch a page through Web Unlocker as markdown.
 * Bright Data replies HTTP 200 even when the target failed, so we request the JSON
 * envelope and read the real status_code + x-brd-error. Retries transient 5xx with
 * backoff; never retries policy blocks.
 */
export async function fetchPage(url: string, opts: { fresh?: boolean } = {}): Promise<PageResult> {
  const key = `page:${url}`;
  if (!opts.fresh) {
    const hit = await readCache(key);
    if (hit) return { ok: true, status: 200, markdown: hit, from_cache: true, attempts: 0 };
  }

  // OFFLINE=1: only use what is already cached (rebuild outputs from earlier fetches without any network calls).
  if (process.env.OFFLINE === "1") return { ok: false, status: 0, markdown: "", error: "offline (not cached)", from_cache: false, attempts: 0 };
  let last: PageResult = { ok: false, status: 0, markdown: "", from_cache: false, attempts: 0 };
  // Bright Data refuses every .gov domain by policy, so go straight to the second fetcher instead of spending a request to be told no.
  let isGov = false;
  try { isGov = /\.gov$/i.test(new URL(url).hostname); } catch {}
  if (isGov && FALLBACK_KEY) {
    const fb = await fallbackFetch(url);
    if (fb) { await writeCache(key, fb); return { ok: true, status: 200, markdown: fb, from_cache: false, attempts: 1, via: "fallback" }; }
    return { ok: false, status: 0, markdown: "", error: ".gov page not retrievable by the second fetcher", blocked_by_policy: true, from_cache: false, attempts: 1 };
  }
  for (let attempt = 1; attempt <= 3 && !isGov; attempt++) {
    const raw = await brd({
      zone: UNLOCKER_ZONE,
      url: encodeURI(decodeURI(url)),
      format: "json",
      data_format: "markdown",
    });
    const d = JSON.parse(raw);
    const error: string | undefined = d.headers?.["x-brd-error"];
    const body: string = d.body ?? "";
    if (d.status_code === 200 && body.trim().length > 200) {
      await writeCache(key, body);
      return { ok: true, status: 200, markdown: body, from_cache: false, attempts: attempt };
    }
    const policy = !!error && /blocked by Bright Data|Access denied/i.test(error);
    last = { ok: false, status: d.status_code ?? 0, markdown: "", error, blocked_by_policy: policy, from_cache: false, attempts: attempt };
    if (policy || (d.status_code >= 400 && d.status_code < 500 && d.status_code !== 429)) break;
    await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
  }
  // Bright Data refuses .gov by policy. Fall back to a second fetcher for those only.
  if (last.blocked_by_policy) {
    const fb = await fallbackFetch(url);
    if (fb) {
      await writeCache(key, fb);
      return { ok: true, status: 200, markdown: fb, from_cache: false, attempts: last.attempts, via: "fallback" };
    }
  }
  return last;
}

const FALLBACK_KEY = process.env.CONTEXT_DEV_API_KEY;

async function fallbackFetch(url: string): Promise<string | null> {
  if (!FALLBACK_KEY) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://api.context.dev/v1/web/scrape/markdown?url=${encodeURIComponent(url)}`,
        { headers: { Authorization: `Bearer ${FALLBACK_KEY}` }, signal: AbortSignal.timeout(90_000) },
      );
      if (res.ok) {
        const d = await res.json();
        if (d.success && typeof d.markdown === "string" && d.markdown.trim().length > 200) return d.markdown;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  return null;
}

/**
 * Fetch a URL through Web Unlocker WITHOUT converting to markdown (JSON/API endpoints, feature services).
 * Same real-status handling as fetchPage. Not cached: callers decide (these are small and change often).
 */
export async function fetchRaw(url: string): Promise<{ ok: boolean; status: number; body: string; error?: string }> {
  let last = { ok: false, status: 0, body: "", error: undefined as string | undefined };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const d = JSON.parse(await brd({ zone: UNLOCKER_ZONE, url, format: "json" }));
    const error: string | undefined = d.headers?.["x-brd-error"];
    if (d.status_code === 200 && (d.body ?? "").length > 0) return { ok: true, status: 200, body: d.body };
    last = { ok: false, status: d.status_code ?? 0, body: "", error };
    if (error && /blocked by Bright Data|Access denied/i.test(error)) break;
    await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));
  }
  return last;
}

// ---- Second fetcher: site discovery + main-content fetch (used for government sites Bright Data refuses) ----
let creditsRemaining: number | null = null;
export const fallbackCredits = () => creditsRemaining;

async function fallbackCall(path: string, init: RequestInit): Promise<any> {
  if (!FALLBACK_KEY) throw new Error("fallback fetcher key not set");
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.context.dev/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${FALLBACK_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 429) { // concurrency/rate limit: wait as told, then retry
      await new Promise((r) => setTimeout(r, 1000 * Number(res.headers.get("retry-after") ?? 2)));
      continue;
    }
    const d: any = await res.json().catch(() => ({}));
    if (d.key_metadata?.credits_remaining != null) creditsRemaining = d.key_metadata.credits_remaining;
    if (res.status === 402) throw new Error("fallback fetcher out of credits");
    if (!res.ok) { if (res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; } throw new Error(`${res.status} ${JSON.stringify(d).slice(0, 120)}`); }
    return d;
  }
  throw new Error("fallback fetcher: too many retries");
}

/** URLs on a domain, optionally ranked by a search phrase and filtered by regex. */
export async function mapSite(domain: string, opts: { search?: string; urlRegex?: string; maxLinks?: number } = {}): Promise<string[]> {
  const q = new URLSearchParams({ domain, maxLinks: String(opts.maxLinks ?? 500) });
  if (opts.search) q.set("search", opts.search);
  if (opts.urlRegex) q.set("urlRegex", opts.urlRegex);
  const d = await fallbackCall(`/web/urls?${q}`, { method: "GET" });
  return (d.urls ?? []).map((u: any) => u.url);
}

/** A page's MAIN content as markdown (navigation and footers removed), any domain. */
export async function scrapeMain(url: string): Promise<string | null> {
  const d = await fallbackCall("/web/scrape", {
    method: "POST",
    body: JSON.stringify({ url, formats: { markdown: true }, sharedParams: { mainContentOnly: true }, markdownParams: { includeLinks: false } }),
  });
  const md = d.markdown?.success ? d.markdown.data : null;
  return typeof md === "string" && md.trim().length > 150 ? md : null;
}

export type NewsResult = { title: string; link: string; source: string; date: string };

/** Google News results via the SERP API. freshness: h=hour d=day w=week m=month y=year. Redirect-only links are dropped. */
export async function serpNews(query: string, freshness = "m"): Promise<NewsResult[]> {
  const key = `news:${freshness}:${query}`;
  let raw = await readCache(key);
  let data: any = raw ? JSON.parse(raw) : null;
  for (let attempt = 0; !data && attempt < 3; attempt++) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws&tbs=qdr:${freshness}&brd_json=1&gl=us&hl=en`;
    const text = await brd({ zone: SERP_ZONE, url, format: "raw" });
    try { data = JSON.parse(text); await writeCache(key, text); } catch { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
  }
  return (data?.news ?? [])
    .map((r: any) => ({ title: r.title ?? "", link: directLink(r), source: r.source ?? "", date: r.date ?? "" }))
    .filter((r: NewsResult) => r.link);
}

export type Review = { rating: number | null; isoDate: string | null; text: string };

/** Newest Google Maps reviews for a place URL (prebuilt parser on the second fetcher; Bright Data's own reviews scraper has been failing). */
export async function mapsReviews(placeUrl: string, limit = 100): Promise<Review[]> {
  const d = await fallbackCall("/web/scrape", {
    method: "POST",
    body: JSON.stringify({ url: placeUrl, formats: { parse: true }, parseParams: { type: "prebuilt", parser: "google-maps-reviews", sort: "newest", limit } }),
  });
  const rows: any[] = d.parsed?.success ? d.parsed.data?.reviews ?? [] : [];
  return rows.filter((r) => r.snippet).map((r) => ({ rating: Number(r.rating) || null, isoDate: r.isoDate ?? null, text: String(r.snippet) }));
}

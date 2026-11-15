// find_sites (owner: M2). Given where a caller is, return the best 1-2 cooling spaces that are open NOW.
//
//   location  -> resolveLocation(): lat/lon, 5-digit ZIP, town name, or address (ZIP/town resolve instantly offline)
//   catalog   -> Neon `sites` over its HTTP SQL endpoint (no extra dependency); falls back to the seed files when the
//                database is unreachable or empty, so the voice line never depends on the network to answer
//   filter    -> fresh (SITE_MAX_AGE_HOURS), open now incl. holiday exceptions, enough time left to get there, accessible
//   rank      -> travel time + penalties for low trust (docs/PROJECT.md formula); returns at most 2
//   speak     -> spoken_summary honors the tier rules: official vs discovered, "call ahead", disagreeing hours
// Writes nothing. The caller logs the `calls` row. No crawling happens here: this is a read.
import type { FindSitesInput, FindSitesOutput, SiteHours, SiteResult } from '../../../../data/schema/types';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TZ = 'America/Los_Angeles';
const MAX_AGE_H = Number(process.env.SITE_MAX_AGE_HOURS ?? 24);
const DB_URL = (process.env.SITES_DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? '').replace(/^"|"$/g, '');
const CATALOG_TTL_MS = 60_000;

type Pt = { lat: number; lon: number };
interface Row {
  id: number; name: string; kind: SiteResult['kind']; tier: SiteResult['tier']; confidence: number | null;
  address: string; zip: string | null; lat: number; lon: number; hours: SiteHours;
  hours_confirmed_on_source: boolean; has_ac: boolean | null; has_filtration: boolean | null; capacity_est: number | null;
  phone: string | null; last_verified_at: string;
  access_level: string; verification: string; ac_source: string | null; has_fee: boolean | null;
}

// ---------------------------------------------------------------- catalog (Neon first, seed as the safety net)

async function readSeed(file: string): Promise<unknown | null> {
  const dirs = [process.env.SITES_SEED_DIR, resolve(process.cwd(), 'data/seed'), resolve(process.cwd(), '../../data/seed'), resolve(process.cwd(), '../data/seed')];
  for (const d of dirs) {
    if (!d) continue;
    try { return JSON.parse(await readFile(resolve(d, file), 'utf8')); } catch { /* try next */ }
  }
  return null;
}

// One SQL read over Neon's HTTP endpoint (no driver dependency). Returns null on any failure so callers fall back to the seed files.
async function sqlRows(query: string, timeoutMs: number): Promise<Record<string, unknown>[] | null> {
  if (!DB_URL) return null;
  try {
    const host = new URL(DB_URL).hostname;
    const res = await fetch(`https://${host}/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': DB_URL },
      body: JSON.stringify({ query, params: [] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { rows?: Record<string, unknown>[] };
    return j.rows && j.rows.length ? j.rows : null; // empty table -> treated as missing
  } catch { return null; }
}

async function neonRows(): Promise<Row[] | null> {
  const rows = await sqlRows('select * from sites', 2000);
  return rows ? rows.map(normalize) : null;
}

function normalize(r: Record<string, unknown>): Row {
  const hours = typeof r.hours === 'string' ? (JSON.parse(r.hours) as SiteHours) : (r.hours as SiteHours);
  return {
    id: Number(r.id), name: String(r.name), kind: r.kind as Row['kind'], tier: r.tier as Row['tier'],
    confidence: r.confidence == null ? null : Number(r.confidence),
    address: String(r.address), zip: r.zip == null ? null : String(r.zip), lat: Number(r.lat), lon: Number(r.lon), hours,
    hours_confirmed_on_source: Boolean(r.hours_confirmed_on_source),
    has_ac: r.has_ac == null ? null : Boolean(r.has_ac), has_filtration: r.has_filtration == null ? null : Boolean(r.has_filtration),
    capacity_est: r.capacity_est == null ? null : Number(r.capacity_est), phone: r.phone == null ? null : String(r.phone),
    last_verified_at: String(r.last_verified_at),
    access_level: r.access_level == null ? 'unknown' : String(r.access_level),
    verification: r.verification == null ? 'single_source' : String(r.verification),
    ac_source: r.ac_source == null ? null : String(r.ac_source),
    has_fee: r.has_fee == null ? null : Boolean(r.has_fee),
  };
}

async function seedRows(): Promise<Row[]> {
  const sites = (await readSeed('sites.json')) as Record<string, unknown>[] | null;
  const extras = ((await readSeed('sites.extras.json')) ?? {}) as Record<string, Record<string, unknown>>;
  return (sites ?? []).map((s) => {
    const x = extras[String(s.id)] ?? {};
    return normalize({ ...s, access_level: x.access_level, verification: x.verification, ac_source: x.ac_from, has_fee: x.has_fee });
  });
}

let cache: { at: number; rows: Row[]; source: 'neon' | 'seed' } | null = null;
async function catalog(): Promise<{ rows: Row[]; source: 'neon' | 'seed' }> {
  if (cache && Date.now() - cache.at < CATALOG_TTL_MS) return cache;
  const db = await neonRows();
  cache = db ? { at: Date.now(), rows: db, source: 'neon' } : { at: Date.now(), rows: await seedRows(), source: 'seed' };
  return cache;
}

// ---------------------------------------------------------------- where is the caller?

interface Places { zips: Record<string, Pt>; places: Record<string, Pt> }
let placesCache: Places | null = null;
async function places(): Promise<Places> {
  if (placesCache) return placesCache;
  const rows = await sqlRows('select kind, key, lat, lon from places', 3000);
  if (rows) {
    const out: Places = { zips: {}, places: {} };
    for (const r of rows) (r.kind === 'zip' ? out.zips : out.places)[String(r.key)] = { lat: Number(r.lat), lon: Number(r.lon) };
    return (placesCache = out);
  }
  return (placesCache = ((await readSeed('places.json')) as Places | null) ?? { zips: {}, places: {} });
}

const km = (a: Pt, b: Pt): number => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
const inCounty = (p: Pt) => p.lat >= 32.5 && p.lat <= 33.52 && p.lon >= -117.62 && p.lon <= -116.07;

const geoCache = new Map<string, Pt | null>();
async function geocode(text: string): Promise<Pt | null> {
  const key = text.toLowerCase().trim();
  if (geoCache.has(key)) return geoCache.get(key) ?? null;
  let out: Pt | null = null;
  try {
    if (/\d{2,5}\s+\w+/.test(text)) { // street address: Census geocoder
      const q = /\bCA\b|California/i.test(text) ? text : `${text}, San Diego County, CA`;
      const r = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`, { signal: AbortSignal.timeout(2000) });
      const m = ((await r.json()) as { result?: { addressMatches?: { coordinates: { x: number; y: number } }[] } }).result?.addressMatches?.[0];
      if (m) out = { lat: m.coordinates.y, lon: m.coordinates.x };
    }
    // Town, landmark, intersection: OpenStreetMap. Prefer a San Diego County match; if there is none, take the plain
    // result so a caller outside the county is told so instead of "I can't tell where you are".
    for (const q of out ? [] : [`${text}, San Diego County, California`, text]) {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'shade-find-sites/1.0' }, signal: AbortSignal.timeout(2000) });
      const j = (await r.json()) as { lat: string; lon: string }[];
      if (j[0]) { out = { lat: Number(j[0].lat), lon: Number(j[0].lon) }; break; }
    }
  } catch { return null; } // do not cache a transient failure
  geoCache.set(key, out);
  return out;
}

// ---- landmarks: "I'm in Geisel Library", "outside the Price Center", "at Westfield UTC" ----------------------------
// data/seed/landmarks.json holds ~5,000 named places (OpenStreetMap + every site we hold). A caller's words are matched
// by token RARITY, so "Geisel" counts for far more than "library", and nobody has to give a ZIP or a city.
interface Landmark { name: string; lat: number; lon: number; kind: string; weight: number; tokens: string[] }
let lmIndex: { items: Landmark[]; df: Map<string, number> } | null | undefined;
const STOP = new Set(['the', 'a', 'an', 'at', 'in', 'on', 'of', 'near', 'by', 'to', 'my', 'im', 'i', 'am', 'is', 'its', 'it', 'so', 'very', 'really', 'hot', 'here', 'where', 'can', 'go', 'right', 'now', 'please', 'help', 'need', 'looking', 'for', 'around', 'next', 'outside', 'inside', 'front', 'nearby', 'close', 'and', 'or', 'with', 'no', 'car', 'currently', 'standing', 'sitting', 'walking', 'stuck', 'somewhere', 'cool', 'place', 'ucsd', 'uc', 'campus', 'university', 'california', 'ca']);
const GENERIC = new Set(['san', 'diego', 'county', 'la', 'jolla', 'city']);                  // geography words that never identify a place on their own
const toTokens = (t: string): string[] => t.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)); // drops "i'm" -> "m" and "it's" -> "s" fragments

async function landmarks() {
  if (lmIndex !== undefined) return lmIndex;
  const rows = await sqlRows('select name, lat, lon, kind, weight from landmarks', 6000);
  const raw: [string, number, number, string, number][] | null = rows
    ? rows.map((r) => [String(r.name), Number(r.lat), Number(r.lon), String(r.kind), Number(r.weight)])
    : ((await readSeed('landmarks.json')) as [string, number, number, string, number][] | null);
  if (!raw) return (lmIndex = null);
  const df = new Map<string, number>();
  const items: Landmark[] = raw.map(([name, lat, lon, kind, weight]) => {
    const tokens = [...new Set(toTokens(name))];
    for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
    return { name, lat, lon, kind, weight, tokens };
  }).filter((l) => l.tokens.length);
  return (lmIndex = { items, df });
}

async function matchLandmark(text: string): Promise<{ pt: Pt; name: string } | null> {
  const idx = await landmarks();
  if (!idx) return null;
  const words = new Set(toTokens(text));
  if (!words.size) return null;
  const lower = text.toLowerCase();
  const onCampus = /\b(ucsd|uc san diego|campus|geisel|price center)\b/.test(lower);
  const inLaJolla = /\bla jolla\b/.test(lower);
  const idf = (t: string) => Math.log(1 + idx.items.length / (idx.df.get(t) ?? 1));
  let best: { l: Landmark; score: number } | null = null;
  for (const l of idx.items) {
    let have = 0, total = 0, distinctive = false, rare = false, matched = 0;
    for (const t of l.tokens) {
      const w = idf(t), d = idx.df.get(t) ?? 99;
      total += w;
      if (words.has(t)) { have += w; matched++; if (!GENERIC.has(t)) distinctive = true; if (d <= 8) rare = true; }
    }
    if (!have || !distinctive) continue;                           // "san diego" alone never identifies a place
    const cov = have / total;
    if (!(cov >= 0.999 || (rare && cov >= 0.3 && matched / words.size > 0.5))) continue; // all of its words, or its distinctive word covering most of what was said
    let score = cov * 10 + have * 0.4 + (matched / words.size) * 4 + l.weight * 0.6; // fuller match, more of what they said, our own sites win
    if (onCampus && l.lat > 32.835 && l.lat < 32.905 && l.lon > -117.3 && l.lon < -117.195) score += 3;
    if (inLaJolla && l.lat > 32.82 && l.lat < 32.91 && l.lon > -117.30 && l.lon < -117.17) score += 2;
    if (!best || score > best.score) best = { l, score };
  }
  return best ? { pt: { lat: best.l.lat, lon: best.l.lon }, name: best.l.name } : null;
}

const STREET_ADDRESS = /\b\d{2,5}\s+(?:[NSEW]\.?\s+)?[A-Za-z0-9.' ]{2,28}\b(?:st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|way|ct|court|pl|place|hwy|highway|pkwy|parkway|cir|circle|ter|terrace)\b/i;

async function resolveLocation(input: FindSitesInput): Promise<{ pt: Pt; zip: string | null; byZip?: boolean; place?: string } | null> {
  const p = await places();
  const nearestZip = (pt: Pt): string | null => {
    let best: string | null = null, d = 15; // km
    for (const [z, c] of Object.entries(p.zips)) { const k = km(pt, c); if (k < d) { d = k; best = z; } }
    return best;
  };
  if (typeof input.lat === 'number' && typeof input.lon === 'number') { const pt = { lat: input.lat, lon: input.lon }; return { pt, zip: nearestZip(pt) }; }

  const text = input.location ?? '';
  // 1. a street address is the most precise thing a caller can say
  if (STREET_ADDRESS.test(text)) { const g = await geocode(text); if (g) return { pt: g, zip: nearestZip(g) }; }
  // 2. a named place ("Geisel Library", "Price Center", "Westfield UTC"): instant, offline, no ZIP or city needed
  const lm = await matchLandmark(text);
  if (lm) return { pt: lm.pt, zip: nearestZip(lm.pt), place: lm.name };
  // 3. a ZIP code
  const zip = text.match(/\b(9[12]\d{3})\b/)?.[1];
  if (zip && p.zips[zip]) return { pt: p.zips[zip], zip, byZip: true };
  // 4. a town or neighborhood
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9' ]/g, ' ')} `;
  const hit = Object.keys(p.places).filter((n) => lower.includes(` ${n} `)).sort((a, b) => b.length - a.length)[0];
  if (hit) return { pt: p.places[hit], zip: nearestZip(p.places[hit]) };
  // 5. anything else: ask an online geocoder (slow, so last)
  const withCampus = /\b(ucsd|uc san diego)\b/i.test(text) ? `${text} La Jolla` : text;
  const g = text.trim() ? (await geocode(withCampus)) ?? (await geocode(toTokens(withCampus).join(' '))) : null; // raw words first, then without the filler
  return g ? { pt: g, zip: nearestZip(g) } : null;
}

// ---------------------------------------------------------------- is it open, and for how long?

function localNow(now: Date): { dow: number; date: string; min: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { dow, date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
}
const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

interface Status { open: boolean; closesMin: number | null; nextOpenMin: number | null; intervals: [number, number][]; note: string | null }
function status(h: SiteHours, now: { dow: number; date: string; min: number }): Status {
  let intervals: [number, number][] = h.weekly.filter((i) => i.day === now.dow).map((i) => [toMin(i.open), toMin(i.close)] as [number, number]).filter(([o, c]) => c > o);
  const ex = h.exceptions?.find((e) => e.date === now.date);
  let note: string | null = null;
  if (ex?.closed) { intervals = []; note = ex.note ? `closed today for ${ex.note}` : 'closed today'; }
  else if (ex?.close) { const cap = toMin(ex.close); intervals = intervals.map(([o, c]) => [o, Math.min(c, cap)] as [number, number]).filter(([o, c]) => c > o); note = ex.note ?? 'closing early today'; }
  const cur = intervals.find(([o, c]) => now.min >= o && now.min < c);
  const later = intervals.filter(([o]) => o > now.min).sort((a, b) => a[0] - b[0])[0];
  return { open: !!cur, closesMin: cur ? cur[1] : null, nextOpenMin: later ? later[0] : null, intervals, note };
}

// ---------------------------------------------------------------- words a person can hear

const ABBR: [RegExp, string][] = [[/\bAve\b\.?/gi, 'Avenue'], [/\bBlvd\b\.?/gi, 'Boulevard'], [/\bSt\b\.?(?!\s*[A-Z][a-z]+'?s)/g, 'Street'], [/\bDr\b\.?/gi, 'Drive'], [/\bRd\b\.?/gi, 'Road'], [/\bLn\b\.?/gi, 'Lane'], [/\bCt\b\.?/gi, 'Court'], [/\bPl\b\.?/gi, 'Place'], [/\bHwy\b\.?/gi, 'Highway'], [/\bE\b\.?(?=\s)/g, 'East'], [/\bW\b\.?(?=\s)/g, 'West'], [/\bN\b\.?(?=\s)/g, 'North'], [/\bS\b\.?(?=\s)/g, 'South']];
function speakAddress(addr: string): string {
  const clean = addr.replace(/,?\s*CA\s*9\d{4}(-\d{4})?\s*$/i, '').replace(/\b(?!(?:NE|NW|SE|SW)\b)[A-Z]{4,}\b/g, '').replace(/\s{2,}/g, ' ').trim(); // drop state/zip and stray ALL-CAPS junk ("PARKING")
  const [street, city] = clean.split(',').map((s) => s.trim());
  let s = ABBR.reduce((t, [re, w]) => t.replace(re, w), street ?? clean);
  s = s.replace(/\b(\d{3,5})\b/, (n) => n.split('').join(' ')); // "201" -> "2 0 1" so it is read digit by digit
  return city && !/^\d/.test(city) ? `${s} in ${city}` : s;
}
function speakTime(min: number, relativeTo: number): string {
  if (min >= 23 * 60 + 55) return 'midnight';
  const h24 = Math.floor(min / 60), m = min % 60, h12 = h24 % 12 || 12;
  const t = m ? `${h12} ${String(m).padStart(2, '0')}` : `${h12}`;
  const part = h24 >= 17 ? (relativeTo >= 17 * 60 ? 'tonight' : 'this evening') : h24 >= 12 ? 'this afternoon' : 'this morning';
  return `${t} ${part}`;
}
const clock = (min: number): string => { const h24 = Math.floor(min / 60), m = min % 60; return `${h24 % 12 || 12}:${String(m).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`; };

// ---------------------------------------------------------------- the tool

const NOT_ALLOWED = new Set(['students_only', 'members_only', 'residents_only', 'age_restricted']);

export async function findSites(input: FindSitesInput): Promise<FindSitesOutput> {
  const catalogReady = catalog(); // read the database while the caller's location is being resolved (voice tool budget is 10 s)
  const loc = await resolveLocation(input);
  if (!loc) return { sites: [], resolved_zip: null, fallback_message: "I couldn't tell where you are. Could you give me your zip code or the nearest cross streets?" };
  if (!inCounty(loc.pt)) return { sites: [], resolved_zip: loc.zip, fallback_message: "I can only look up cooling spaces in San Diego County. For help anywhere else, call 2 1 1." };

  const now = input.now ? new Date(input.now) : new Date();
  const lt = localNow(now);
  const noCar = input.needs?.has_car === false || input.needs?.mobility_issues === true;
  const maxTravel = input.needs?.max_travel_minutes ?? (noCar ? 45 : 40);
  const { rows } = await catalogReady;
  if (loc.byZip) {
    const inZip = rows.filter((r) => r.zip === loc.zip);
    if (inZip.length) loc.pt = { lat: inZip.reduce((a, r) => a + r.lat, 0) / inZip.length, lon: inZip.reduce((a, r) => a + r.lon, 0) / inZip.length };
  }

  const cands: { r: Row; miles: number; travel: number; st: Status; score: number; mode: 'car' | 'walk' | 'transit' }[] = [];
  const later: { r: Row; miles: number; st: Status }[] = [];
  for (const r of rows) {
    if (now.getTime() - Date.parse(r.last_verified_at) > MAX_AGE_H * 3600_000) continue; // stale: never present as open
    if (NOT_ALLOWED.has(r.access_level)) continue;                                       // students / members / residents / age-restricted
    if (r.has_fee === true) continue;                                                    // free public spaces only
    if (r.tier === 'discovered') {
      if (r.kind === 'other' && r.has_ac !== true) continue;                             // parks, attractions: not known to be cool
      if (/\b(museum|zoo|aquarium|gallery|theat(?:er|re)|cinema)\b/i.test(r.name)) continue; // usually paid admission
      const allDay = r.hours.weekly.length >= 5 && r.hours.weekly.every((i) => i.open === '00:00' && i.close >= '23:59');
      if (allDay && r.verification !== 'confirmed') continue;                            // Maps "open 24 hours" is almost always an outdoor place
    }
    const miles = km(loc.pt, r) * 0.621371 * 1.3;                                        // straight line x road factor
    const mode: 'car' | 'walk' | 'transit' = !noCar ? 'car' : miles <= 1 ? 'walk' : 'transit';
    const travel = Math.round(mode === 'car' ? 3 + (miles / 22) * 60 : mode === 'walk' ? miles * 20 : 10 + (miles / 12) * 60);
    if (travel > maxTravel) continue;
    const st = status(r.hours, lt);
    if (!st.open) { if (st.nextOpenMin !== null) later.push({ r, miles, st }); continue; }
    if (st.closesMin! - lt.min < travel + 10) continue;                                  // would close before or just after arrival
    const trust = r.tier === 'discovered' ? 20 * (1 - (r.confidence ?? 0.5)) : 0;       // low-trust penalty (docs/PROJECT.md)
    const score = travel + trust + (r.verification === 'conflict' ? 10 : 0) - (r.hours_confirmed_on_source ? 2 : 0);
    cands.push({ r, miles, travel, st, score, mode });
  }
  cands.sort((a, b) => a.score - b.score);

  const picked: typeof cands = [];
  const seen = new Set<string>();
  for (const c of cands) {                                                                // top 2, no duplicate places
    const key = c.r.address.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
    if (seen.has(key)) continue;
    seen.add(key); picked.push(c);
    if (picked.length === 2) break;
  }

  if (!picked.length) {
    const soon = later.map((l) => ({ ...l, d: l.miles })).sort((a, b) => a.d - b.d)[0];
    return {
      sites: [], resolved_zip: loc.zip,
      fallback_message: soon
        ? `Nothing near you is open right now. The closest, ${soon.r.name}, opens at ${clock(soon.st.nextOpenMin!)} today. You can also call 2 1 1 for help finding a cool place.`
        : 'I could not find a cooling space near you that is open right now. Please call 2 1 1 and they can help find one. If anyone feels faint, confused, or very ill from the heat, call 9 1 1.',
    };
  }

  const sites: SiteResult[] = picked.map((c, i) => {
    const { r, st } = c;
    const closes = st.closesMin!;
    const coolZone = r.ac_source === 'official_program';
    const callAhead = r.tier === 'discovered' || r.verification === 'conflict';
    const until = `open until ${speakTime(closes, lt.min)}`;
    const nm = r.name === r.name.toUpperCase() ? r.name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : r.name; // read ALL-CAPS names naturally
    const here = c.miles < 0.06;                                                         // the caller is standing at this very place
    const lead = i === 0 ? (loc.place && !here ? `From ${loc.place}, the closest option is` : 'The closest option is') : 'Another option is';
    let said: string;
    if (here && i === 0) {
      said = `You're right at ${nm}, and it's ${until}.${r.has_ac ? ' It should be air conditioned.' : ''}`;
    } else if (r.tier === 'official') {
      said = `${lead} ${nm} at ${speakAddress(r.address)}. ${coolZone ? 'It is an official county Cool Zone' : 'It is an official city or county facility'}, ${until}.`;
    } else {
      said = `${lead} ${nm} at ${speakAddress(r.address)}. It's not an official cooling center, but it should be ${r.has_ac ? 'air conditioned and ' : ''}${until}. You may want to call ahead.`;
    }
    if (r.verification === 'conflict') said += ' The hours listed for it differ between sources, so please call ahead.';
    if (st.note) said += ` Note: it is ${st.note}.`;
    if (c.mode === 'transit') said += ' If you do not have a ride, 2 1 1 can help arrange free transportation to a cooling space.';
    const q = encodeURIComponent(`${r.name} ${r.address}`);
    return {
      site_id: r.id, name: r.name, kind: r.kind, tier: r.tier, address: r.address,
      open_now: true, closes_at: hhmm(closes),
      hours_today: st.intervals.map(([o, e]) => `${clock(o)} - ${clock(e)}`).join(', '),
      travel_minutes: c.travel, distance_miles: Math.round(c.miles * 10) / 10,
      aqi: null, // AirNow is not wired yet; the contract allows null
      has_filtration: r.has_filtration, confidence: r.confidence, call_ahead: callAhead,
      map_url: `https://www.google.com/maps/search/?api=1&query=${q}`,
      spoken_summary: said,
    };
  });
  return { sites, resolved_zip: loc.zip, ...(loc.place ? { resolved_place: loc.place } : {}) };
}

// Load the catalog, places and landmark index in the background when the server starts, so the first call is already fast.
export function warmFindSites(): void {
  void catalog().catch(() => undefined);
  void places().catch(() => undefined);
  void landmarks().catch(() => undefined);
}
warmFindSites();

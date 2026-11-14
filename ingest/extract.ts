// Step 3: Gemini reads each fetched page (markdown) and returns structured site records.
//   node --env-file=.env ingest/extract.ts [maxPages]
// Needs GEMINI_API_KEY (Google AI Studio / Gemini API). Override the model with GEMINI_MODEL.
import { readFile, writeFile } from "node:fs/promises";

// Provider switch: EXTRACT_PROVIDER=claude uses Claude (default model: Haiku 5.5, override with
// CLAUDE_EXTRACT_MODEL); anything else uses Gemini. Same schema, same verification gate.
const PROVIDER = process.env.EXTRACT_PROVIDER ?? "gemini";
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const CLAUDE_MODEL = process.env.CLAUDE_EXTRACT_MODEL ?? "claude-haiku-5-5";
if (PROVIDER !== "claude" && !KEY) throw new Error("Set GEMINI_API_KEY in .env (or EXTRACT_PROVIDER=claude)");
if (PROVIDER === "claude" && !process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY in .env");

// Gemini's schema dialect (UPPERCASE types, nullable:true) -> standard JSON Schema for Claude.
function toJsonSchema(n: any): any {
  const out: any = { ...n };
  if (typeof n.type === "string") out.type = n.type.toLowerCase();
  if (n.nullable) { out.type = [out.type, "null"]; delete out.nullable; }
  if (n.enum && n.nullable) out.enum = [...n.enum, null];
  if (n.properties) {
    out.properties = Object.fromEntries(Object.entries(n.properties).map(([k, v]) => [k, toJsonSchema(v)]));
    out.required = Object.keys(n.properties); // strict output: every field present (nullable when unknown)
    out.additionalProperties = false;
  }
  if (n.items) out.items = toJsonSchema(n.items);
  return out;
}

const ACCESS = ["open_to_all", "students_only", "members_only", "residents_only", "age_restricted", "unknown"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const schema = {
  type: "OBJECT",
  properties: {
    sites: {
      type: "ARRAY",
      description: "Every distinct physical place on the page that someone could walk into. Empty if none.",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          kind: { type: "STRING", enum: ["library", "rec_center", "community_center", "senior_center", "cool_zone", "mall", "other"] },
          address: { type: "STRING", nullable: true },
          phone: { type: "STRING", nullable: true },
          hours: {
            type: "ARRAY",
            description: "Regular weekly hours. One entry per open day; omit closed days. 24h HH:MM.",
            items: {
              type: "OBJECT",
              properties: {
                day: { type: "STRING", enum: DAYS },
                open: { type: "STRING" },
                close: { type: "STRING" },
              },
              required: ["day", "open", "close"],
            },
          },
          hours_note: { type: "STRING", nullable: true, description: "Holiday, seasonal or exception text, verbatim" },
          access_level: { type: "STRING", enum: ACCESS },
          access_notes: { type: "STRING", nullable: true, description: "Who may enter, e.g. 'Seniors 60+', 'Students with ID'" },
          requires_id: { type: "BOOLEAN", nullable: true },
          has_fee: { type: "BOOLEAN", nullable: true },
          has_ac: { type: "BOOLEAN", nullable: true, description: "true only if the page says air conditioned / cooling center" },
          confidence: { type: "NUMBER", description: "0-1: how sure you are the hours and access are correct and current" },
          evidence: { type: "STRING", description: "Short verbatim quote supporting the hours/access" },
        },
        required: ["name", "kind", "hours", "access_level", "confidence", "evidence"],
      },
    },
  },
  required: ["sites"],
};

const prompt = (url: string, md: string) => `You extract public cooling-site data for a heat-relief phone line.
Use ONLY the page text below. Never invent hours, addresses or access rules; use null / "unknown" when the page does not say.
access_level = "open_to_all" only if the page clearly says the public is welcome or it is a public library/city facility with no restriction stated.
Ignore navigation, ads and unrelated organizations (directories, offices, services that are not a place to sit indoors).
Lower the confidence when hours are missing, ambiguous, or look outdated.
"evidence" must be copied EXACTLY, character for character, from the page text (never reworded or reformatted). If the support is in separate places, copy each exact fragment and join them with " ... ". Prefer the exact hours text.
Use the site's full official name as written on the page.

Page URL: ${url}
--- PAGE TEXT ---
${md.slice(0, 15000)}`;

// Gemini returns 503/429 under load and the connection sometimes drops: retry with backoff.
async function extract(url: string, md: string) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await extractOnce(url, md);
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message;
      if (!/503|429|500|fetch failed|timeout|aborted/i.test(msg)) throw e; // real errors: don't retry
      await new Promise((r) => setTimeout(r, 3000 * 2 ** attempt));
    }
  }
  throw lastErr;
}

async function extractClaude(url: string, md: string) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ maxRetries: 4 }); // SDK retries 429/5xx with backoff
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    output_config: { effort: "low", format: { type: "json_schema", schema: toJsonSchema(schema) } },
    messages: [{ role: "user", content: prompt(url, md) }],
  } as any);
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens")
    throw new Error(`Claude stopped: ${response.stop_reason}`);
  const text = response.content.find((b: any) => b.type === "text") as any;
  return JSON.parse(text.text).sites as any[];
}

async function extractOnce(url: string, md: string) {
  if (PROVIDER === "claude") return extractClaude(url, md);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      signal: AbortSignal.timeout(120_000),
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY! },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt(url, md) }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return JSON.parse(data.candidates[0].content.parts[0].text).sites as any[];
}

async function main() {
  const max = Number(process.argv[2] ?? 200);
  const load = async (f: string) => JSON.parse(await readFile(new URL(`./data/${f}`, import.meta.url), "utf8").catch(() => "[]"));
  const pages = [...(await load("pages.json")), ...(await load("pages_maps.json"))].slice(0, max);
  const out: any[] = [];
  const rejected: any[] = [];

  async function one(p: any) {
    const isSnippet = p.source_type === "serp_snippet";
    if (p.markdown.trim().length < (isSnippet ? 60 : 300)) {
      console.log(`– skip ${p.domain} (too little text)`);
      return;
    }
    // For Maps-sourced pages we know which place the site belongs to; say so (not part of the quote source).
    const hint = p.maps_name ? `[This page is the website of "${p.maps_name}", ${p.maps_address}. Extract that place only.]\n` : "";
    try {
      const sites = await extract(p.url, hint + p.markdown);
      let kept = 0;
      for (const s of sites) {
        // Anti-hallucination gate: the evidence quote must appear verbatim in the source.
        const verified = quoteInSource(s.evidence, p.markdown);
        const rec = {
          ...s,
          evidence_verified: verified,
          source_type: p.source_type ?? "page",
          // Snippets are partial text: cap how much we trust them.
          confidence: isSnippet ? Math.min(s.confidence ?? 0, 0.6) : s.confidence,
          area: p.area,
          source_url: p.url,
          maps_place_id: p.maps_place_id ?? null,
          last_verified_at: p.fetched_at,
          tier: "discovered",
        };
        if (verified) { out.push(rec); kept++; } else rejected.push(rec);
      }
      console.log(`✓ ${p.domain}${isSnippet ? " (snippet)" : ""} → ${kept}/${sites.length} verified`);
    } catch (e) {
      console.error(`✗ ${p.url}: ${(e as Error).message}`);
    }
  }

  // Small worker pool: Claude handles parallel requests; Gemini's free tier does not (use 1).
  const workers = PROVIDER === "claude" ? 4 : 1;
  let next = 0;
  await Promise.all(Array.from({ length: workers }, async () => { while (next < pages.length) await one(pages[next++]); }));

  await writeFile(new URL("./data/sites.json", import.meta.url), JSON.stringify(out, null, 2));
  await writeFile(new URL("./data/rejected.json", import.meta.url), JSON.stringify(rejected, null, 2));
  console.log(`\n${out.length} verified sites → ingest/data/sites.json | ${rejected.length} rejected (quote not found in source)`);
}

// Compare ignoring case, markdown punctuation and whitespace differences.
const squash = (s: string) =>
  s.toLowerCase().replace(/[  ]/g, " ").replace(/[*_`#>\[\]()|]/g, "").replace(/\s+/g, " ").trim();
// A quote may join several exact fragments with "..." ; EVERY fragment must appear in the source.
function quoteInSource(quote: string | undefined, source: string): boolean {
  if (!quote || quote.trim().length < 8) return false;
  const src = squash(source);
  const frags = quote.split(/\s*(?:\.{3}|…)\s*/).map(squash).filter((f) => f.length >= 8);
  return frags.length > 0 && frags.every((f) => src.includes(f));
}

main();

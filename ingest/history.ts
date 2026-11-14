// Versioned page history + change detection. Every fetch is recorded; a new content hash
// means the source changed. Snapshots are stored by hash so any version can be re-read or
// re-extracted. (Mirrors a `source_page_versions` table in Neon.)
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

const DIR = new URL("./data/", import.meta.url);
const LOG = new URL("./data/history.jsonl", import.meta.url);
const snap = (hash: string) => new URL(`./data/snapshots/${hash}.md`, import.meta.url);

export type Version = {
  url: string;
  fetched_at: string;
  status: number;
  ok: boolean;
  content_hash: string | null;
  chars: number;
  error?: string;
  blocked_by_policy?: boolean;
};

// Strip volatile bits (timestamps, tracking params, whitespace) so we only flag real edits.
export function normalize(md: string): string {
  return md
    .replace(/\?[^\s)"']*(utm_|fbclid|sessionid|_ga)[^\s)"']*/gi, "")
    .replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
export const hashOf = (md: string) => createHash("sha256").update(normalize(md)).digest("hex").slice(0, 16);

export async function allVersions(): Promise<Version[]> {
  try {
    return (await readFile(LOG, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export async function lastGood(url: string): Promise<Version | null> {
  const vs = (await allVersions()).filter((v) => v.url === url && v.ok && v.content_hash);
  return vs.at(-1) ?? null;
}

export type Change = {
  url: string;
  kind: "new" | "changed" | "unchanged" | "failed";
  previous_hash?: string | null;
  content_hash?: string | null;
  added_lines: string[];
  removed_lines: string[];
};

export async function record(
  url: string,
  r: { ok: boolean; status: number; markdown: string; error?: string; blocked_by_policy?: boolean },
): Promise<Change> {
  const prev = await lastGood(url);
  const v: Version = {
    url,
    fetched_at: new Date().toISOString(),
    status: r.status,
    ok: r.ok,
    content_hash: r.ok ? hashOf(r.markdown) : null,
    chars: r.markdown.length,
    error: r.error,
    blocked_by_policy: r.blocked_by_policy,
  };
  await mkdir(new URL("./snapshots/", DIR), { recursive: true });
  await appendFile(LOG, JSON.stringify(v) + "\n");

  if (!r.ok) return { url, kind: "failed", previous_hash: prev?.content_hash, added_lines: [], removed_lines: [] };
  await writeFile(snap(v.content_hash!), normalize(r.markdown));
  if (!prev) return { url, kind: "new", content_hash: v.content_hash, added_lines: [], removed_lines: [] };
  if (prev.content_hash === v.content_hash)
    return { url, kind: "unchanged", content_hash: v.content_hash, previous_hash: prev.content_hash, added_lines: [], removed_lines: [] };

  const before = new Set((await readFile(snap(prev.content_hash!), "utf8").catch(() => "")).split("\n"));
  const after = normalize(r.markdown).split("\n");
  const afterSet = new Set(after);
  return {
    url,
    kind: "changed",
    content_hash: v.content_hash,
    previous_hash: prev.content_hash,
    added_lines: after.filter((l) => l && !before.has(l)).slice(0, 30),
    removed_lines: [...before].filter((l) => l && !afterSet.has(l)).slice(0, 30),
  };
}

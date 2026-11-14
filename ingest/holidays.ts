// Holiday closures from the county's official Cool Zone site list (PDF), parsed in CODE, not by a model.
// The PDF lists each site's observed holidays by rule ("Fourth Thursday in November"), so dates are computed, not guessed.
//   node --env-file=.env ingest/holidays.ts [daysAhead=400]
// Output: ingest/data/holidays.json keyed by the county layer's OBJECTID -> contract `HoursException[]`
// ({ date: "YYYY-MM-DD", closed?, close?, note? }) so a caller on a holiday is not sent to a closed building.
import { readFile, writeFile } from "node:fs/promises";

const DAYS = Number(process.argv[2] ?? 400);
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// nth weekday of a month (n = 1..4) or the last (n = -1). weekday: 0 = Sunday.
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  if (n > 0) {
    const first = new Date(year, month, 1);
    return new Date(year, month, 1 + ((7 + weekday - first.getDay()) % 7) + 7 * (n - 1));
  }
  const last = new Date(year, month + 1, 0);
  return new Date(year, month, last.getDate() - ((7 + last.getDay() - weekday) % 7));
}

// Holiday name (as the PDF writes it) -> date in a given year. Only recognised names are used; anything else is ignored.
const RULES: [RegExp, string, (y: number) => Date][] = [
  [/birthday of martin luther king/i, "Martin Luther King Jr. Day", (y) => nthWeekday(y, 0, 1, 3)],
  [/washington'?s birthday|presidents'? day/i, "Presidents' Day", (y) => nthWeekday(y, 1, 1, 3)],
  [/memorial day/i, "Memorial Day", (y) => nthWeekday(y, 4, 1, -1)],
  [/juneteenth/i, "Juneteenth", (y) => new Date(y, 5, 19)],
  [/independence day/i, "Independence Day", (y) => new Date(y, 6, 4)],
  [/labor day/i, "Labor Day", (y) => nthWeekday(y, 8, 1, 1)],
  [/columbus day|indigenous peoples/i, "Columbus Day", (y) => nthWeekday(y, 9, 1, 2)],
  [/veterans day/i, "Veterans Day", (y) => new Date(y, 10, 11)],
  [/day after thanksgiving/i, "Day after Thanksgiving", (y) => nthWeekday(y, 10, 5, 4)],
  [/thanksgiving day/i, "Thanksgiving Day", (y) => nthWeekday(y, 10, 4, 4)],
  [/christmas day/i, "Christmas Day", (y) => new Date(y, 11, 25)],
  [/new year'?s day/i, "New Year's Day", (y) => new Date(y, 0, 1)],
  [/cesar chavez/i, "César Chávez Day", (y) => new Date(y, 2, 31)],
];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

async function main() {
  const zones: any[] = JSON.parse(await readFile(new URL("./data/official_cool_zones.json", import.meta.url), "utf8"));
  const pages: any[] = JSON.parse(await readFile(new URL("./data/pages_official.json", import.meta.url), "utf8"));
  const pdf: string = pages.find((p) => /CoolZoneSiteList\.pdf$/i.test(p.url))?.markdown ?? "";
  if (!pdf) throw new Error("county Cool Zone PDF not found in pages_official.json (run official.ts)");

  // Locate each site's block: its street number + first street word, up to where the next site begins.
  const key = (z: any) => { const m = String(z.street ?? "").match(/^(\d+)\s+(\w+)/); return m ? new RegExp(`\\b${m[1]}\\s+${m[2]}`, "i") : null; };
  const found = zones.map((z) => ({ z, pos: key(z) ? pdf.search(key(z)!) : -1 })).filter((f) => f.pos >= 0).sort((a, b) => a.pos - b.pos);

  const from = new Date(), to = new Date(Date.now() + DAYS * 86400_000);
  const out: Record<string, any> = {};
  for (const [i, f] of found.entries()) {
    const block = pdf.slice(f.pos, found[i + 1]?.pos ?? pdf.length);
    const ex = new Map<string, any>();
    for (const line of block.split("\n").map((l) => l.trim()).filter(Boolean)) {
      // "December 24, close at 2:00pm"
      const early = line.match(/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+close at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
      if (early) {
        const mi = MONTHS.indexOf(early[1].toLowerCase());
        let h = Number(early[3]) % 12 + (early[5].toLowerCase() === "pm" ? 12 : 0);
        for (const y of [from.getFullYear(), from.getFullYear() + 1, from.getFullYear() + 2]) {
          const d = new Date(y, mi, Number(early[2]));
          if (d >= from && d <= to) ex.set(iso(d), { date: iso(d), close: `${pad(h)}:${early[4] ?? "00"}`, note: "Closes early" });
        }
        continue;
      }
      for (const [re, name, date] of RULES) {
        if (!re.test(line)) continue;
        for (const y of [from.getFullYear(), from.getFullYear() + 1, from.getFullYear() + 2]) {
          const d = date(y);
          if (d >= from && d <= to) ex.set(iso(d), { date: iso(d), closed: true, note: name });
        }
        break;
      }
    }
    if (ex.size) out[f.z.objectid] = { name: f.z.name, exceptions: [...ex.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  }
  await writeFile(new URL("./data/holidays.json", import.meta.url), JSON.stringify(out, null, 1));

  const next = Object.values(out).flatMap((v: any) => v.exceptions).sort((a: any, b: any) => a.date.localeCompare(b.date));
  console.log(`${found.length} of ${zones.length} official sites located in the PDF; ${Object.keys(out).length} have holiday closures (${next.length} dated exceptions in the next ${DAYS} days)`);
  const upcoming = [...new Set(next.map((e: any) => `${e.date} ${e.note}`))].slice(0, 6);
  console.log("next dates:", upcoming.join(" | "));
  console.log("→ ingest/data/holidays.json");
}

main();

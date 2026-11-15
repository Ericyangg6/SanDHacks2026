import { useEffect, useRef, useState } from 'react';
import type { CallEvent, HelpRequest, LiveCall, ReadingRow } from './api';
import { LANG, SOURCE, clockAt, deg, stamp, stage, whenAt } from './format';

interface Props {
  requests: HelpRequest[]; calls: LiveCall[]; reqError: string | null; req: number | null; fresh: number | null; onReq(id: number): void;
  readings: ReadingRow[]; generatedAt: string | null; zip: string | null; onZip(zip: string): void;
}

export function SidePanel(p: Props) {
  return (
    <aside className="glass panel" id="side">
      <Requests {...p} />
      <Readings {...p} />
    </aside>
  );
}

/* ---------- help requests (GET /dispatch/requests) ---------- */
function Requests({ requests, calls, reqError, req, fresh, onReq, readings }: Props) {
  const [open, setOpen] = useState(new Set<string>());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // Picking a request (here or on its map marker) expands its card and brings it into view. Small screens stack the
  // list under the map, so scrolling there would carry the page away from the marker's popup.
  // The scroll waits for the render that expands the card (declared first, it runs a commit after the effect below).
  const selRef = useRef<HTMLElement>(null);
  const scroll = useRef(false);
  useEffect(() => {
    if (!scroll.current) return;
    scroll.current = false;
    if (matchMedia('(min-width: 1001px)').matches) selRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  useEffect(() => {
    if (req == null) return;
    scroll.current = true;
    setOpen((s) => new Set(s).add(`r${req}`));
    // Unpicking (or picking another) collapses the card entirely, trail included.
    return () => setOpen((s) => { const n = new Set(s); n.delete(`r${req}`); return n; });
  }, [req]);
  const count = (st: string) => requests.filter((r) => r.status === st).length;
  const area = (zip: string | null) => readings.find((r) => r.zip === zip)?.area ?? zip;
  const summary = reqError ? `Can't load help requests (${reqError})`
    : `${calls.length ? `${calls.length} on call, ` : ''}${count('requesting')} locating help, ${count('incoming')} help incoming`;
  const sorted = [...requests].sort((a, b) => +(a.status === 'incoming') - +(b.status === 'incoming'));

  return (
    <section className="scroll" aria-labelledby="qh">
      <div className="head">
        <h2 id="qh">Help requests</h2>
        <p role="status">{summary}</p>
      </div>
      <div>
        {calls.map((c) => (
          <article key={`c${c.id}`} className="req-row call">
            <h3>Call in progress</h3><span className="meta">No help request yet · started {clockAt(c.started_at)}</span>
            <Trail open={open.has(`c${c.id}`)} onToggle={() => toggle(`c${c.id}`)} {...stage(c.events)} events={c.events} live />
          </article>
        ))}
        {sorted.map((r) => {
          const want = r.status === 'requesting';
          const meta = [area(r.zip), `Call${r.language && LANG[r.language] ? `, ${LANG[r.language]}` : ''}`, clockAt(r.created_at)].filter(Boolean).join(' · ');
          return (
            // A click anywhere on the card picks it; only the heading button also unpicks it.
            <article key={r.id} ref={req === r.id ? selRef : undefined} className={`req-row ${req === r.id ? 'sel' : ''} ${fresh === r.id ? 'new' : ''}`}
              onClick={() => req !== r.id && onReq(r.id)}>
              <button className="open" aria-expanded={req === r.id} onClick={(e) => { e.stopPropagation(); onReq(r.id); }}>
                <h3>{r.location}</h3>
                <span className="meta">{meta}</span>
              </button>
              <div className="chips">{r.needs.map((x) => <span key={x} className="chip">{x}</span>)}</div>
              <Trail open={open.has(`r${r.id}`)} onToggle={() => toggle(`r${r.id}`)} {...stage(r.events ?? [], r.status)}
                events={r.events ?? []} live={want} />
              <div className="more"><p className="said">“{r.said}”</p></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** One line: status pill and the latest step. `live` shimmers while the call or a neighbor's answer is still pending. */
function Trail({ open, onToggle, pill, label, events, live }: { open: boolean; onToggle(): void; pill: string; label: string; events: CallEvent[]; live?: boolean }) {
  return <>
    <button className={`agent ${live ? 'live' : ''}`} aria-expanded={open} title="Show every step of this call" onClick={onToggle}>
      <span className={`st ${pill}`}>{label}</span><span className="now">{events.at(-1)?.text ?? 'No steps recorded'}</span>
      <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
    </button>
    {open && <ol className="log" aria-label="Every step of this call, oldest first">
      {events.map((e, i) => <li key={i}>{e.text}<small>{stamp(e.at)}</small></li>)}
    </ol>}
  </>;
}

/* ---------- readings ---------- */
function Readings({ readings, generatedAt, zip, onZip }: Props) {
  const heat = (r: ReadingRow) => r.heat_index ?? r.temp_f ?? -Infinity;
  const all = [...readings].sort((a, b) => heat(b) - heat(a));
  const r = all.find((x) => x.zip === zip) ?? all[0];   // default to the hottest zip
  const shown = all.slice(0, 3);   // the three hottest zips; the selected one is added if it isn't among them
  if (r && !shown.includes(r)) shown.push(r);
  const future = r && generatedAt && new Date(r.time) > new Date(generatedAt);

  return (
    <section className="rule" id="readings" aria-labelledby="rh" style={{ paddingBottom: 8 }}>
      <div className="head">
        <h2 id="rh">Readings</h2>
        <p>{!r ? 'No readings yet' : r.area === r.zip ? r.zip : `${r.area} ${r.zip}`}</p>
      </div>
      {r && <>
        <div className="now">
          <div><b>{deg(r.temp_f)}</b><span>Temperature</span></div>
          <div><b>{deg(r.heat_index)}</b><span>Feels like</span></div>
        </div>
        <p className="note">{SOURCE[r.source]} {future ? 'forecast for' : 'reading at'} {whenAt(r.time)}.</p>
        <div className="rrow rhead"><span>Area</span><span>Temp</span><span>Feels</span></div>
        <div>{shown.map((x) => (
          <button key={x.zip} className="rrow" aria-pressed={x.zip === r.zip} onClick={() => onZip(x.zip)}>
            <span className="area">{x.area === x.zip ? '' : x.area}<small className="mono">{x.zip}</small></span>
            <span className="n">{deg(x.temp_f)}</span><span className="n">{deg(x.heat_index)}</span>
          </button>
        ))}</div>
      </>}
    </section>
  );
}

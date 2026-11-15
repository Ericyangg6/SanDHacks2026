// Leaflet driven imperatively: 400+ markers are cheaper as Leaflet objects than as React children.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DashboardState, HelpRequest, Zone } from './api';
import { stage } from './format';

// Leaflet places each marker with translate3d, which gives every marker its own GPU layer: 400+ of them cost ~8 ms a frame
// while panning. left/top keeps them all in the marker pane's single layer. That rules out animating them through a zoom,
// so markerZoomAnimation is off and they hide for the 250 ms zoom instead. Past a few thousand sites, draw them on a canvas.
(L.Marker as any).include({
  _setPos(this: any, pos: L.Point) {
    if (this._icon) { this._icon.style.left = `${pos.x}px`; this._icon.style.top = `${pos.y}px`; }
    this._zIndex = pos.y + this.options.zIndexOffset; this._resetZIndex();
  },
});

export const AST = '<svg viewBox="0 0 24 24"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/></svg>';
const icon = (html: string, size: number) => L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
const zoneIcon = (z: Zone, sel: boolean) => icon(`<div class="tk zone ${z.tier} ${sel ? 'sel' : ''}">${AST}</div>`, 34);
const reqIcon = (r: HelpRequest, sel: boolean) => icon(`<div class="tk req ${r.status === 'incoming' ? 'incoming' : 'requesting'} ${sel ? 'sel' : ''}"></div>`, 30);
const dotIcon = (n: number) => (n === 1 ? icon('<div class="dot"></div>', 9) : icon(`<div class="dot n">${n}</div>`, 18));
// One line: status pill and what the caller needs. Built from DOM nodes: needs come from what callers said, so they never go through innerHTML.
function reqPopup(r: HelpRequest) {
  const el = (tag: string, cls: string, text: string) => Object.assign(document.createElement(tag), { className: cls, textContent: text });
  const { label, pill } = stage(r.events ?? [], r.status);
  const box = el('div', 'req-pop', '');
  box.append(el('span', `st ${pill}`, label), el('span', 'need', r.needs.length ? r.needs.join(', ') : r.said));
  return box;
}
const pad = (): L.FitBoundsOptions => (innerWidth > 1000 ? { paddingTopLeft: [380, 100], paddingBottomRight: [410, 40] } : { padding: [30, 30] });

interface Props {
  sites: Zone[]; calls: DashboardState['calls']; requests: HelpRequest[];
  zone: number | null; req: number | null;
  onZone(id: number): void; onReq(id: number): void;
}

export function MapView({ sites, calls, requests, zone, req, onZone, onReq }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const m = useRef<{ map: L.Map; calls: L.LayerGroup; zones: L.LayerGroup; reqs: L.LayerGroup; markers: Map<number, L.Marker>; fitted: boolean }>(null);
  const on = useRef({ onZone, onReq });
  on.current = { onZone, onReq };

  useEffect(() => {
    // Locked to San Diego County (32.53..33.51 N, 117.60..116.08 W) plus a margin: Tijuana, Temecula, the Salton Sea.
    const map = L.map(el.current!, { zoomControl: false, markerZoomAnimation: false, minZoom: 10, maxBounds: [[32.0, -118.6], [34.0, -115.2]], maxBoundsViscosity: 1 }).setView([32.79, -117.04], 11);
    L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'USGS The National Map' }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    m.current = { map, calls: L.layerGroup().addTo(map), zones: L.layerGroup().addTo(map), reqs: L.layerGroup().addTo(map), markers: new Map(), fitted: false };
    return () => { map.remove(); m.current = null; };
  }, []);

  useEffect(() => {
    const s = m.current!;
    const seen = new Set<number>();
    for (const z of sites) {
      seen.add(z.id);
      const ic = zoneIcon(z, zone === z.id);
      const mk = s.markers.get(z.id);
      if (!mk) s.markers.set(z.id, L.marker([z.lat, z.lon], { title: z.name, icon: ic }).addTo(s.zones).on('click', () => on.current.onZone(z.id)));
      // setIcon rebuilds the marker's DOM node: only touch the ones whose look changed.
      else if ((mk.options.icon as L.DivIcon).options.html !== ic.options.html) mk.setIcon(ic).setZIndexOffset(zone === z.id ? 1000 : 0);
    }
    for (const [id, mk] of s.markers) if (!seen.has(id)) { s.zones.removeLayer(mk); s.markers.delete(id); }
    if (!s.fitted && sites.length) { s.fitted = true; s.map.fitBounds(L.latLngBounds(sites.map((z) => [z.lat, z.lon])), pad()); }
  }, [sites, zone]);

  useEffect(() => {
    const s = m.current!;
    s.calls.clearLayers();
    for (const c of calls) L.marker([c.lat, c.lon], { icon: dotIcon(c.n), interactive: false, keyboard: false }).addTo(s.calls);
  }, [calls]);

  useEffect(() => {   // a request whose location couldn't be placed has a card but no marker
    const s = m.current!;
    s.reqs.clearLayers();
    for (const r of requests) if (r.lat != null && r.lon != null) {
      const mk = L.marker([r.lat, r.lon], { icon: reqIcon(r, req === r.id), title: r.location, zIndexOffset: 500 }).addTo(s.reqs).on('click', () => on.current.onReq(r.id));
      // The selected request's status pops up over its marker; a poll that changes it redraws the popup with it.
      if (req === r.id) mk.bindPopup(reqPopup(r), { autoPan: false, offset: [0, -10] }).openPopup();
    }
  }, [requests, req]);

  // Fly only when the selection changes, not when a poll brings new data.
  useEffect(() => {
    const z = sites.find((x) => x.id === zone);
    if (z) m.current!.map.flyTo([z.lat, z.lon], 14, { duration: 0.8 });
  }, [zone]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const r = requests.find((x) => x.id === req);
    if (r?.lat != null && r.lon != null) m.current!.map.flyTo([r.lat, r.lon], 14, { duration: 0.8 });
  }, [req]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div id="map" ref={el} aria-label="Map of San Diego County cool zones and help requests" />;
}

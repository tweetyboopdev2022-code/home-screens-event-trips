import React from 'react';
import type { PluginComponentProps } from './hs-plugin';
import { hostFrameStyle } from './host-style';
import {
  CalEvent, Person, HourlyWeather, resolveSourceIds, selectTrips, shortPlace,
  weatherInfo, weatherAt, leaveBy, formatDuration, coordKey, townFromLocation, trafficLevel, TrafficLevel,
} from './logic';

const PLUGIN_ID = 'event-trips';
const GEO_TTL_MS = 30 * 86400000;
// Set when TomTom calls fail (usually: no key saved yet); retried after an hour.
let tomtomDownUntil = 0;
const tomtomOk = () => Date.now() > tomtomDownUntil;
const markTomtomDown = () => { tomtomDownUntil = Date.now() + 3600000; };

interface Geo { lat: number; lon: number; label?: string; town?: string }
interface Route { seconds: number; delay: number; meters: number }
interface TripData { geo?: Geo | null; weather?: ReturnType<typeof weatherAt>; route?: Route | null }

type Props = PluginComponentProps & { people?: Person[]; timeFormat?: string; units?: string };

function sdk() { return (window as any).__HS_SDK__; }

async function proxied(url: string, cacheTtlMs: number, extra: Record<string, unknown> = {}) {
  const res: Response = await sdk().pluginFetch(PLUGIN_ID, { url, cacheTtlMs, ...extra });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function readGeoCache(q: string): Geo | null | undefined {
  try {
    const raw = localStorage.getItem('event-trips:geo2:' + q.toLowerCase());
    if (!raw) return undefined;
    const v = JSON.parse(raw);
    if (Date.now() - v.at > GEO_TTL_MS) return undefined;
    return v.geo;
  } catch { return undefined; }
}
function writeGeoCache(q: string, geo: Geo | null) {
  try { localStorage.setItem('event-trips:geo2:' + q.toLowerCase(), JSON.stringify({ at: Date.now(), geo })); } catch { /* ignore */ }
}

async function geocode(q: string, near: Geo | null, useTomTom: boolean): Promise<Geo | null> {
  const cached = readGeoCache(q);
  if (cached !== undefined) return cached;
  let geo: Geo | null = null;
  if (useTomTom && tomtomOk()) {
    try {
      const bias = near ? `&lat=${near.lat}&lon=${near.lon}` : '';
      const j = await proxied(
        `https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?limit=1${bias}`,
        3600000,
        { secretInjections: { query: { key: '{{tomtom_key}}' } } },
      );
      const r = j?.results?.[0];
      if (r?.position) geo = { lat: r.position.lat, lon: r.position.lon, label: r.poi?.name ?? r.address?.freeformAddress, town: r.address?.municipality || r.address?.municipalitySubdivision };
    } catch { markTomtomDown(); }
  }
  if (!geo) {
    try {
      const j = await proxied(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`,
        3600000,
        { headers: { 'User-Agent': 'home-screens-event-trips/1.0', 'Accept-Language': 'en' } },
      );
      const r = j?.[0];
      if (r) { const a = r.address ?? {}; geo = { lat: Number(r.lat), lon: Number(r.lon), label: r.name || undefined, town: a.city || a.town || a.village || a.municipality }; }
    } catch { /* give up */ }
  }
  writeGeoCache(q, geo);
  return geo;
}

async function forecast(g: Geo, imperial: boolean): Promise<HourlyWeather | undefined> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${g.lat.toFixed(3)}&longitude=${g.lon.toFixed(3)}`
    + `&hourly=temperature_2m,precipitation_probability,weather_code&timeformat=unixtime&forecast_days=10`
    + (imperial ? '&temperature_unit=fahrenheit' : '');
  const j = await proxied(url, 1800000);
  return j?.hourly;
}

function isoNoMs(d: Date) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

async function route(from: Geo, to: Geo, ev: CalEvent, mode: string): Promise<Route | null> {
  const start = new Date(ev.start).getTime();
  const soon = start - Date.now() < 3 * 3600000;
  // Live traffic for trips in the next few hours; predicted traffic an hour before later ones.
  const depart = soon ? 'now' : isoNoMs(new Date(Math.max(Date.now() + 60000, start - 3600000)));
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json`
    + `?traffic=true&travelMode=${mode}&routeType=fastest&departAt=${encodeURIComponent(depart)}`;
  const j = await proxied(url, soon ? 600000 : 3600000, { secretInjections: { query: { key: '{{tomtom_key}}' } } });
  const s = j?.routes?.[0]?.summary;
  if (!s) return null;
  return { seconds: s.travelTimeInSeconds, delay: s.trafficDelayInSeconds ?? 0, meters: s.lengthInMeters };
}

const LEVEL: Record<TrafficLevel, { color: string; label: string }> = {
  clear: { color: '#16a34a', label: 'Traffic clear' },
  moderate: { color: '#d97706', label: 'Moderate traffic' },
  heavy: { color: '#dc2626', label: 'Heavy traffic' },
};

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3em', padding: '0.15em 0.6em', borderRadius: '999px', background: `${color}22`, color, fontWeight: 500, fontSize: '0.72em', whiteSpace: 'nowrap' }}>
      <span style={{ width: '0.55em', height: '0.55em', borderRadius: '50%', background: color }} />{children}
    </span>
  );
}

export default function EventTrips(props: Props) {
  const { config, style } = props;
  const personName = String(config.personName ?? 'Vince');
  const sourceIdsCfg = String(config.sourceIds ?? '');
  const daysAhead = Number(config.daysAhead ?? 7);
  const maxEvents = Number(config.maxEvents ?? 5);
  const buffer = Number(config.bufferMinutes ?? 10);
  const showTraffic = config.showTraffic !== false;
  const showWeather = config.showWeather !== false;
  const travelMode = String(config.travelMode ?? 'car');
  const accent = String(config.accentColor || '#059669');
  const title = String(config.title ?? '');
  const originAddress = String(config.originAddress ?? '').trim();
  const refreshMs = Math.max(60000, Number(config.refreshIntervalMs ?? 600000));
  const imperial = props.units === 'imperial';
  const tz = props.timezone;
  const hour12 = props.timeFormat === '24h' ? false : props.timeFormat === '12h' ? true : undefined;

  const [now, setNow] = React.useState(() => new Date());
  const [tick, setTick] = React.useState(0);
  const [data, setData] = React.useState<Record<string, TripData>>({});
  const [noKey, setNoKey] = React.useState(false);

  React.useEffect(() => {
    const a = setInterval(() => setNow(new Date()), 20000);
    const b = setInterval(() => setTick((t) => t + 1), refreshMs);
    return () => { clearInterval(a); clearInterval(b); };
  }, [refreshMs]);

  const events = (props.events ?? []) as CalEvent[];
  const ids = resolveSourceIds(props.people, personName, sourceIdsCfg);
  const trips = selectTrips(events, ids, now, daysAhead, maxEvents);
  const sig = trips.map((t) => `${t.id}|${t.start}|${t.location}`).join('~');

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const hs = sdk()?.getHostSettings?.() ?? {};
      let origin: Geo | null =
        props.latitude != null && props.longitude != null ? { lat: props.latitude, lon: props.longitude }
        : hs.latitude != null ? { lat: hs.latitude, lon: hs.longitude } : null;
      if (originAddress) origin = (await geocode(originAddress, origin, true)) ?? origin;
      const wx: Record<string, Promise<HourlyWeather | undefined>> = {};
      let missingKey = false;
      const out: Record<string, TripData> = {};
      for (const ev of trips) {
        const d: TripData = {};
        d.geo = await geocode(ev.location!, origin, true);
        if (d.geo && showWeather) {
          const k = coordKey(d.geo.lat, d.geo.lon);
          wx[k] ??= forecast(d.geo, imperial).catch(() => undefined);
          d.weather = weatherAt(await wx[k], ev);
        }
        const startsIn = new Date(ev.start).getTime() - Date.now();
        if (d.geo && origin && showTraffic && !ev.allDay && !missingKey && tomtomOk() && startsIn > -15 * 60000) {
          try { d.route = await route(origin, d.geo, ev, travelMode); }
          catch (e) {
            if (/HTTP (400|401|403|500)/.test(String((e as Error).message))) { missingKey = true; markTomtomDown(); }
            d.route = null;
          }
        }
        out[ev.id] = d;
        if (alive) setData((prev) => ({ ...prev, [ev.id]: d }));
      }
      if (alive) { setData(out); setNoKey(missingKey || !tomtomOk()); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, tick, originAddress, showTraffic, showWeather, travelMode, imperial]);

  const fmtTime = (d: Date) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12, timeZone: tz }).format(d);
  const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(d);
  const fmtDay = (d: Date) => {
    const k = dayKey(d);
    if (k === dayKey(now)) return 'Today';
    if (k === dayKey(new Date(now.getTime() + 86400000))) return 'Tomorrow';
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).format(d);
  };
  const deg = imperial ? '°F' : '°';
  const km = (m: number) => (imperial ? `${(m / 1609).toFixed(m < 16000 ? 1 : 0)} mi` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
  const townOf = (ev: CalEvent, d: TripData) => d.geo?.town || townFromLocation(ev.location!) || '';

  const root: React.CSSProperties = {
    ...hostFrameStyle(style as any),
    width: '100%', height: '100%', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: '0.7em', overflow: 'hidden',
  };

  const wxChip = (d: TripData, ev: CalEvent, big = false) => {
    const w = d.weather; if (!showWeather || !w) return null;
    const info = weatherInfo(w.code); const town = townOf(ev, d);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4em', padding: big ? '0.45em 0.8em' : '0.25em 0.6em', borderRadius: '0.8em', background: 'rgba(127,127,127,0.12)', fontSize: big ? '0.95em' : '0.78em', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: '1.4em', lineHeight: 1 }} title={info.label}>{info.icon}</span>
        <span style={{ fontWeight: 600 }}>{Math.round(w.temp)}{deg}</span>
        {w.pop != null && w.pop >= 30 && <span style={{ opacity: 0.75 }}>💧{w.pop}%</span>}
        {town && <span style={{ opacity: 0.7 }}>· {town}</span>}
      </div>
    );
  };

  if (trips.length === 0) {
    return (
      <div style={root}>
        {title && <div style={{ fontSize: '1.1em', fontWeight: 600 }}>{title}</div>}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', opacity: 0.6, gap: '0.4em' }}>
          <div style={{ fontSize: '2.4em' }}>🗺️</div>
          <div style={{ fontWeight: 500 }}>Nowhere to be in the next {daysAhead} days</div>
          <div style={{ fontSize: '0.75em', maxWidth: '28em' }}>Add a location to a calendar event and it shows up here with the weather there and when to leave.</div>
        </div>
      </div>
    );
  }

  const [next, ...rest] = trips;
  const nd = data[next.id] ?? {};
  const nStart = new Date(next.start);
  const nr = nd.route;
  const leave = nr ? leaveBy(next, nr.seconds, buffer) : null;
  const minsToLeave = leave ? Math.round((leave.getTime() - now.getTime()) / 60000) : null;
  const inProgress = nStart.getTime() <= now.getTime();
  const lvl = nr ? trafficLevel(nr.seconds, nr.delay) : null;
  const urgency = minsToLeave == null ? accent : minsToLeave <= 5 ? '#dc2626' : minsToLeave <= 20 ? '#d97706' : accent;
  const leaveHeadline = inProgress ? 'Happening now'
    : minsToLeave == null ? (next.allDay ? 'All day' : `Starts ${fmtTime(nStart)}`)
    : minsToLeave <= 0 ? 'Leave now'
    : minsToLeave < 60 ? `Leave in ${minsToLeave} min`
    : `Leave at ${fmtTime(leave!)}`;
  // progress toward leave time over the last 2 hours
  const pct = minsToLeave == null ? 0 : Math.max(0, Math.min(1, 1 - minsToLeave / 120));

  return (
    <div style={root}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '1.05em', fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: '0.65em', opacity: 0.55 }}>{trips.length} coming up</div>
        </div>
      )}

      {/* Hero: the next trip */}
      <div style={{ borderRadius: '1em', padding: '0.9em 1em', background: `${accent}1f`, display: 'flex', flexDirection: 'column', gap: '0.5em', borderLeft: `0.35em solid ${next.calendarColor || accent}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.8em' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.7em', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.65 }}>
              {fmtDay(nStart)} · {next.allDay ? 'All day' : fmtTime(nStart)}
            </div>
            <div style={{ fontSize: '1.2em', fontWeight: 600, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{next.title}</div>
            <div style={{ fontSize: '0.8em', opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              📍 {shortPlace(next.location!)}{townOf(next, nd) && shortPlace(next.location!) !== townOf(next, nd) ? `, ${townOf(next, nd)}` : ''}
            </div>
          </div>
          {wxChip(nd, next, true)}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '0.6em', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '2.3em', fontWeight: 700, lineHeight: 1, color: urgency, letterSpacing: '-0.02em' }}>{leaveHeadline}</div>
          {nr && leave && !inProgress && (
            <div style={{ fontSize: '0.8em', opacity: 0.8, textAlign: 'right' }}>arrive {fmtTime(new Date(leave.getTime() + nr.seconds * 1000))}<br />{buffer ? `${buffer} min early` : ''}</div>
          )}
        </div>

        {nr && !inProgress && (
          <div style={{ height: '0.35em', borderRadius: '999px', background: 'rgba(127,127,127,0.2)', overflow: 'hidden' }}>
            <div style={{ width: `${pct * 100}%`, height: '100%', background: urgency, transition: 'width 1s' }} />
          </div>
        )}

        {showTraffic && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.7em', flexWrap: 'wrap', fontSize: '0.9em' }}>
            {nr ? (
              <>
                <span style={{ fontWeight: 600 }}>🚗 {formatDuration(nr.seconds)}</span>
                <span style={{ opacity: 0.65 }}>{km(nr.meters)}</span>
                {lvl && <Badge color={LEVEL[lvl].color}>{nr.delay >= 60 ? `+${formatDuration(nr.delay)} · ` : ''}{LEVEL[lvl].label}</Badge>}
              </>
            ) : next.allDay ? null : (
              <span style={{ opacity: 0.55, fontSize: '0.85em' }}>{noKey ? 'Add a TomTom key for drive times' : 'Checking traffic…'}</span>
            )}
          </div>
        )}
      </div>

      {/* Later trips */}
      {rest.length > 0 && <div style={{ fontSize: '0.65em', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.55, marginTop: '0.2em' }}>Later</div>}
      {rest.map((ev) => {
        const d = data[ev.id] ?? {};
        const st = new Date(ev.start);
        const r = d.route;
        const l = r ? leaveBy(ev, r.seconds, buffer) : null;
        const lv = r ? trafficLevel(r.seconds, r.delay) : null;
        return (
          <div key={ev.id} style={{ display: 'grid', gridTemplateColumns: '5.4em 1fr auto', gap: '0.7em', alignItems: 'center', padding: '0.5em 0.7em', borderRadius: '0.8em', background: 'rgba(127,127,127,0.09)', fontSize: '0.88em' }}>
            <div>
              <div style={{ fontSize: '0.72em', fontWeight: 600, opacity: 0.6, textTransform: 'uppercase' }}>{fmtDay(st)}</div>
              <div style={{ fontWeight: 600 }}>{ev.allDay ? 'All day' : fmtTime(st)}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.title}</div>
              <div style={{ fontSize: '0.8em', display: 'flex', gap: '0.6em', alignItems: 'center', flexWrap: 'wrap', opacity: 0.85 }}>
                {r && l ? <><span>Leave {fmtTime(l)}</span><span style={{ opacity: 0.7 }}>🚗 {formatDuration(r.seconds)}</span>{lv && lv !== 'clear' && <Badge color={LEVEL[lv].color}>+{formatDuration(r.delay)}</Badge>}</>
                  : <span style={{ opacity: 0.7 }}>📍 {shortPlace(ev.location!)}</span>}
              </div>
            </div>
            {wxChip(d, ev)}
          </div>
        );
      })}
    </div>
  );
}

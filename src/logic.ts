// Pure helpers for the Event Trips plugin — no React, no SDK, so they can be unit-tested.

export interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  allDay: boolean;
  sourceId?: string;
  calendarColor?: string;
}

export interface Person {
  id?: string;
  name: string;
  color?: string;
  sourceIds?: string[];
}

/** Locations that are not places you drive to (video calls, links, "TBD"). */
export function isDrivableLocation(loc: string | undefined): boolean {
  if (!loc) return false;
  const s = loc.trim().toLowerCase();
  if (s.length < 3) return false;
  if (/^https?:\/\//.test(s)) return false;
  if (/(zoom\.us|meet\.google|teams\.microsoft|webex|whereby|discord\.gg)/.test(s)) return false;
  if (/^(tbd|tba|online|virtual|remote|home|phone|call)$/.test(s)) return false;
  return true;
}

/** Source ids to include: explicit ids win, else the named person's calendars. */
export function resolveSourceIds(
  people: Person[] | undefined,
  personName: string,
  explicitIds: string,
): string[] | null {
  const ids = explicitIds.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length) return ids;
  const name = personName.trim().toLowerCase();
  if (!name) return null; // null = every calendar
  const p = (people ?? []).find((x) => x.name.trim().toLowerCase() === name);
  return p?.sourceIds?.length ? p.sourceIds : [];
}

export function selectTrips(
  events: CalEvent[],
  sourceIds: string[] | null,
  now: Date,
  daysAhead: number,
  maxEvents: number,
): CalEvent[] {
  const horizon = now.getTime() + daysAhead * 86400000;
  return events
    .filter((e) => (sourceIds === null ? true : !!e.sourceId && sourceIds.includes(e.sourceId)))
    .filter((e) => isDrivableLocation(e.location))
    .filter((e) => new Date(e.end).getTime() > now.getTime() && new Date(e.start).getTime() < horizon)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .slice(0, maxEvents);
}

/** Short place label: "Costco Wholesale, 3500 Boul..., Boisbriand" -> "Costco Wholesale". */
export function shortPlace(loc: string): string {
  const first = loc.split(/\n|,/)[0].trim();
  return first.length > 0 ? first : loc.trim();
}

/** WMO weather code -> emoji + label (Open-Meteo). */
export function weatherInfo(code: number | undefined): { icon: string; label: string } {
  if (code === undefined || code === null) return { icon: '·', label: '' };
  if (code === 0) return { icon: '☀️', label: 'Clear' };
  if (code <= 2) return { icon: '🌤️', label: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', label: 'Cloudy' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Fog' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: 'Drizzle' };
  if (code >= 61 && code <= 67) return { icon: '🌧️', label: 'Rain' };
  if (code >= 71 && code <= 77) return { icon: '🌨️', label: 'Snow' };
  if (code >= 80 && code <= 82) return { icon: '🌧️', label: 'Showers' };
  if (code === 85 || code === 86) return { icon: '🌨️', label: 'Snow showers' };
  if (code >= 95) return { icon: '⛈️', label: 'Thunderstorm' };
  return { icon: '☁️', label: '' };
}

export interface HourlyWeather {
  time: (string | number)[];
  temperature_2m: number[];
  precipitation_probability?: (number | null)[];
  weather_code?: number[];
}

/** Pick the forecast hour closest to the event start (noon for all-day events). */
export function weatherAt(
  hourly: HourlyWeather | undefined,
  ev: CalEvent,
): { temp: number; pop: number | null; code?: number } | null {
  if (!hourly?.time?.length) return null;
  let target = new Date(ev.start).getTime();
  if (ev.allDay) {
    const d = new Date(ev.start);
    target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
  }
  let best = -1;
  let bestDiff = Infinity;
  hourly.time.forEach((t, i) => {
    // Open-Meteo returns unix seconds when timeformat=unixtime
    const ms = typeof t === 'number' || /^\d+$/.test(t) ? Number(t) * 1000 : new Date(t).getTime();
    const diff = Math.abs(ms - target);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  if (best < 0 || bestDiff > 3 * 3600000) return null; // beyond forecast range
  return {
    temp: hourly.temperature_2m[best],
    pop: hourly.precipitation_probability?.[best] ?? null,
    code: hourly.weather_code?.[best],
  };
}

export function leaveBy(ev: CalEvent, travelSeconds: number, bufferMinutes: number): Date {
  return new Date(new Date(ev.start).getTime() - travelSeconds * 1000 - bufferMinutes * 60000);
}

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Round coordinates so nearby events share a weather request. */
export function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

/** Town from a Google-style address: "Rue Corona, Rosemère, QC, Canada" -> "Rosemère". */
export function townFromLocation(loc: string): string | undefined {
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  const i = parts.findIndex((p) => /^[A-Z]{2}(\s+[A-Z0-9]{3}\s?[A-Z0-9]{3}|\s+\d{5}(-\d{4})?)?$/.test(p));
  if (i > 0) return parts[i - 1];
  if (parts.length >= 3) return parts[parts.length - 2];
  return undefined;
}

export type TrafficLevel = 'clear' | 'moderate' | 'heavy';
export function trafficLevel(seconds: number, delay: number): TrafficLevel {
  if (delay < 120 || delay / Math.max(seconds - delay, 1) < 0.1) return 'clear';
  if (delay / Math.max(seconds - delay, 1) < 0.3 && delay < 900) return 'moderate';
  return 'heavy';
}

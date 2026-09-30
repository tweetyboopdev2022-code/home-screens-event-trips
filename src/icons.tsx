import React from 'react';

type Shape = string | { c: [number, number, number] };
// Lucide-style outline icons, drawn in currentColor to match the host's outline weather set.
export function Icon({ d, size = '1em', stroke = 2, style }: { d: Shape[]; size?: string; stroke?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: 'block', ...style }} aria-hidden>
      {d.map((p, i) => (typeof p === 'string' ? <path key={i} d={p} /> : <circle key={i} cx={p.c[0]} cy={p.c[1]} r={p.c[2]} />))}
    </svg>
  );
}
const C = (x: number, y: number, r: number): Shape => ({ c: [x, y, r] });
const CLOUD_TOP = 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242';
export const I = {
  pin: ['M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0', C(12, 10, 3)],
  car: ['M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2', C(7, 17, 2), 'M9 17h6', C(17, 17, 2)],
  clock: [C(12, 12, 10), 'M12 6v6l4 2'],
  flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
  drop: ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'],
  sun: [C(12, 12, 4), 'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41', 'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41'],
  cloudSun: ['M12 2v2', 'm4.93 4.93 1.41 1.41', 'M20 12h2', 'm19.07 4.93-1.41 1.41', 'M15.947 12.65a4 4 0 0 0-5.925-4.128', 'M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z'],
  cloud: ['M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'],
  fog: [CLOUD_TOP, 'M16 17H7', 'M17 21H9'],
  rain: [CLOUD_TOP, 'M16 14v6', 'M8 14v6', 'M12 16v6'],
  snow: [CLOUD_TOP, 'M8 15h.01', 'M8 19h.01', 'M12 17h.01', 'M12 21h.01', 'M16 15h.01', 'M16 19h.01'],
  storm: ['M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973', 'm13 12-3 5h4l-3 5'],
};
export function wxIcon(code: number | undefined): Shape[] {
  if (code == null) return I.cloud;
  if (code === 0) return I.sun;
  if (code <= 2) return I.cloudSun;
  if (code === 3) return I.cloud;
  if (code === 45 || code === 48) return I.fog;
  if (code >= 71 && code <= 77) return I.snow;
  if (code === 85 || code === 86) return I.snow;
  if (code >= 95) return I.storm;
  if (code >= 51) return I.rain;
  return I.cloud;
}

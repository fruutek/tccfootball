import { formatLongDate, formatMonth, formatShortDate, weekdayName } from '../shared/dates';

export { formatLongDate, formatMonth, formatShortDate, weekdayName };

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The viewer's local date as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Stable hue (0–359) from any string — gives each player a consistent placeholder avatar. */
export function hueFrom(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

const TEAM_COLOURS: Record<string, string> = {
  red: '#ef4d57',
  blue: '#3d8bff',
  green: '#36c26e',
  yellow: '#f2c230',
  orange: '#ff8a2b',
  purple: '#9b6bff',
  pink: '#ff6fae',
  teal: '#26c6b5',
  white: '#eef1f5',
  black: '#58616f',
  grey: '#8b95a5',
};

/** Team colour → CSS colour. Named colours are tuned to read on the dark background. */
export function teamColour(colour: string): string {
  return TEAM_COLOURS[colour] ?? (/^#[0-9a-f]{6}$/i.test(colour) ? colour : '#8b95a5');
}

export function readingMinutes(text: string): number {
  return Math.max(1, Math.round(text.trim().split(/\s+/).length / 220));
}

export function pct(n: number): string {
  return `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`;
}

export function shortId(path: string, section: string): string | null {
  const m = new RegExp(`^/${section}/([^/?#]+)`).exec(path);
  if (!m || m[1] === '_') return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

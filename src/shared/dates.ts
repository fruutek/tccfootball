/**
 * Calendar-date helpers. Match dates are plain "YYYY-MM-DD" strings (the local
 * date the game was played), so they never shift with time zones.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isMonday(date: string): boolean {
  return weekdayOf(date) === 1;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** The next Monday strictly after `from` (so a Monday returns the following Monday). */
export function nextMondayAfter(from: string): string {
  const wd = weekdayOf(from);
  const delta = ((1 - wd + 7) % 7) || 7;
  return addDays(from, delta);
}

/** Today's date in a given IANA time zone, as YYYY-MM-DD. */
export function todayIn(timeZone = 'Europe/London', now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function weekdayName(date: string): string {
  return WEEKDAYS[weekdayOf(date)] ?? '';
}

export function monthName(month1to12: number): string {
  return MONTHS[month1to12 - 1] ?? '';
}

/** "2 November 2026" */
export function formatLongDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${monthName(m)} ${y}`;
}

/** "Mon 2 Nov" */
export function formatShortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${weekdayName(date).slice(0, 3)} ${d} ${monthName(m).slice(0, 3)}`;
}

/** "Nov 2026" */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${monthName(m).slice(0, 3)} ${y}`;
}

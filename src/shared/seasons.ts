/**
 * Seasons and periods.
 *
 * A season is derived from a match date and the site's `season.startMonth`
 * setting (1 = calendar year, e.g. 8 = August to July). It is never stored on
 * a match, so changing the setting re-buckets history without any migration.
 */

export type Period =
  | { kind: 'all' }
  | { kind: 'season'; id: string }
  | { kind: 'month'; id: string };

export const ALL_TIME: Period = { kind: 'all' };

export function seasonIdOf(date: string, startMonth = 1): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  if (startMonth <= 1) return String(y);
  const startYear = m >= startMonth ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** "2026" stays "2026"; "2025-26" becomes "2025/26". */
export function seasonLabel(id: string): string {
  return id.replace('-', '/');
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function inPeriod(date: string, period: Period, startMonth = 1): boolean {
  switch (period.kind) {
    case 'all':
      return true;
    case 'season':
      return seasonIdOf(date, startMonth) === period.id;
    case 'month':
      return monthOf(date) === period.id;
  }
}

/** Distinct season ids present in the given dates, newest first. */
export function listSeasons(dates: string[], startMonth = 1): string[] {
  return [...new Set(dates.map((d) => seasonIdOf(d, startMonth)))].sort().reverse();
}

/** Distinct YYYY-MM months present in the given dates, newest first. */
export function listMonths(dates: string[]): string[] {
  return [...new Set(dates.map(monthOf))].sort().reverse();
}

export function periodKey(p: Period): string {
  return p.kind === 'all' ? 'all' : `${p.kind}:${p.id}`;
}

export function parsePeriod(value: string | null | undefined): Period {
  if (!value || value === 'all') return ALL_TIME;
  const [kind, ...rest] = value.split(':');
  const id = rest.join(':');
  if (kind === 'season' && id) return { kind: 'season', id };
  if (kind === 'month' && /^\d{4}-\d{2}$/.test(id)) return { kind: 'month', id };
  return ALL_TIME;
}

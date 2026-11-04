/**
 * Everything the pages need, derived once from the loaded data and memoised.
 * All numbers come from the shared stats engine — no page does its own maths.
 */
import { listMonths, listSeasons, periodKey, type Period } from '../shared/seasons';
import { compareMatches, computeStats, matchesForPeriod, startingTotalsOf, type PlayerStats } from '../shared/stats';
import type { Article, Match, Player, SiteSettings } from '../shared/schema';
import type { SiteData } from './data';

export interface Index {
  data: SiteData;
  startMonth: number;
  formLength: number;
  minAppearances: number;
  players: Map<string, Player>;
  matchesAsc: Match[];
  matchesDesc: Match[];
  articlesDesc: Article[];
  seasons: string[];
  months: string[];
  nameOf: (id: string) => string;
  /** True when anyone has goals/assists recorded from before match tracking began. */
  hasStartingTotals: boolean;
  stats: (period: Period) => Map<string, PlayerStats>;
  matchCount: (period: Period) => number;
  reportFor: (matchId: string) => Article | undefined;
  nextFixture: (today: string) => NonNullable<SiteSettings['nextFixture']> | null;
}

const cache = new WeakMap<SiteData, Index>();

export function getIndex(data: SiteData): Index {
  const hit = cache.get(data);
  if (hit) return hit;

  const startMonth = data.settings?.seasonStartMonth ?? 1;
  const formLength = data.settings?.formLength ?? 5;
  const minAppearances = data.settings?.minAppearances ?? 5;
  const players = new Map(data.players.map((p) => [p.id, p]));
  const matchesAsc = data.matches.filter((m) => m.status === 'published').sort(compareMatches);
  const matchesDesc = [...matchesAsc].reverse();
  const articlesDesc = data.articles
    .filter((a) => a.status === 'published')
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
  const dates = matchesAsc.map((m) => m.date);

  const startingTotals = startingTotalsOf(data.players);
  const statsCache = new Map<string, Map<string, PlayerStats>>();
  const stats = (period: Period) => {
    const key = periodKey(period);
    let s = statsCache.get(key);
    if (!s) {
      s = computeStats(matchesAsc, { period, seasonStartMonth: startMonth, formLength, startingTotals });
      statsCache.set(key, s);
    }
    return s;
  };

  const index: Index = {
    data,
    startMonth,
    formLength,
    minAppearances,
    players,
    matchesAsc,
    matchesDesc,
    articlesDesc,
    seasons: listSeasons(dates, startMonth),
    months: listMonths(dates),
    nameOf: (id) => players.get(id)?.displayName ?? id,
    hasStartingTotals: startingTotals.size > 0,
    stats,
    matchCount: (period) => matchesForPeriod(matchesAsc, period, startMonth).length,
    reportFor: (matchId) => articlesDesc.find((a) => a.matchId === matchId && a.category === 'match-report'),
    nextFixture: (today) => {
      const f = data.settings?.nextFixture;
      return f && f.date >= today ? f : null;
    },
  };
  cache.set(data, index);
  return index;
}

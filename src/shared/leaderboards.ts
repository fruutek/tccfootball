import type { PlayerStats } from './stats';

export type LeaderboardKey =
  | 'goals'
  | 'assists'
  | 'appearances'
  | 'wins'
  | 'winPct'
  | 'goalsPerGame'
  | 'potm'
  | 'winStreak';

export interface LeaderboardDef {
  key: LeaderboardKey;
  label: string;
  /** Column heading / compact label. */
  short: string;
  blurb: string;
  /** Percentage / average boards need a minimum-appearances rule. */
  rate: boolean;
  value: (s: PlayerStats) => number;
  format: (n: number) => string;
  /** Secondary ordering when the main value is tied (highest first). */
  tiebreak: ((s: PlayerStats) => number)[];
}

const int = (n: number) => String(Math.round(n));

export const LEADERBOARDS: Record<LeaderboardKey, LeaderboardDef> = {
  goals: {
    key: 'goals', label: 'Top scorers', short: 'Goals', blurb: 'Most goals scored', rate: false,
    value: (s) => s.goals, format: int,
    tiebreak: [(s) => s.goalsPerGame, (s) => s.assists],
  },
  assists: {
    key: 'assists', label: 'Top assists', short: 'Assists', blurb: 'Most goals set up', rate: false,
    value: (s) => s.assists, format: int,
    tiebreak: [(s) => s.assistsPerGame, (s) => s.goals],
  },
  appearances: {
    key: 'appearances', label: 'Appearances', short: 'Apps', blurb: 'Most matches played', rate: false,
    value: (s) => s.appearances, format: int,
    tiebreak: [(s) => s.wins, (s) => s.goals],
  },
  wins: {
    key: 'wins', label: 'Most wins', short: 'Wins', blurb: 'Most matches won', rate: false,
    value: (s) => s.wins, format: int,
    tiebreak: [(s) => s.winPct, (s) => s.goals],
  },
  winPct: {
    key: 'winPct', label: 'Win rate', short: 'Win %', blurb: 'Highest share of matches won', rate: true,
    value: (s) => s.winPct, format: (n) => `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`,
    tiebreak: [(s) => s.wins, (s) => s.appearances],
  },
  goalsPerGame: {
    key: 'goalsPerGame', label: 'Goals per game', short: 'G/Game', blurb: 'Best scoring average', rate: true,
    value: (s) => s.goalsPerGame, format: (n) => n.toFixed(2),
    tiebreak: [(s) => s.goals, (s) => s.appearances],
  },
  potm: {
    key: 'potm', label: 'Player of the match', short: 'POTM', blurb: 'Most player of the match awards', rate: false,
    value: (s) => s.potm, format: int,
    tiebreak: [(s) => s.wins, (s) => s.goals],
  },
  winStreak: {
    key: 'winStreak', label: 'Winning streak', short: 'Streak', blurb: 'Current run of consecutive wins', rate: false,
    value: (s) => s.currentWinStreak, format: int,
    tiebreak: [(s) => s.longestWinStreak, (s) => s.wins],
  },
};

export const LEADERBOARD_ORDER: LeaderboardKey[] = [
  'goals', 'assists', 'appearances', 'wins', 'winPct', 'goalsPerGame', 'potm', 'winStreak',
];

/**
 * Minimum appearances for rate-based boards: the configured number, but never
 * more than half the matches in the period — so a four-game month still has a
 * sensible board instead of excluding everybody.
 */
export function minAppearancesFor(matchesInPeriod: number, configured: number): number {
  return Math.max(1, Math.min(configured, Math.ceil(matchesInPeriod / 2)));
}

export interface LeaderboardRow {
  /** Standard competition ranking: equal values share a rank. */
  rank: number;
  tied: boolean;
  value: number;
  stats: PlayerStats;
}

const EPS = 1e-9;

export function buildLeaderboard(
  all: Iterable<PlayerStats>,
  key: LeaderboardKey,
  opts: { minAppearances: number; nameOf?: (id: string) => string },
): LeaderboardRow[] {
  const def = LEADERBOARDS[key];
  const nameOf = opts.nameOf ?? ((id: string) => id);
  const eligible = [...all].filter((s) => {
    if (s.appearances === 0) return false;
    if (def.rate && s.appearances < opts.minAppearances) return false;
    // Counting boards list only players who have actually done the thing.
    if (!def.rate && key !== 'appearances' && def.value(s) <= 0) return false;
    if (key === 'goalsPerGame' && s.goals === 0) return false;
    return true;
  });

  eligible.sort((x, y) => {
    const dv = def.value(y) - def.value(x);
    if (Math.abs(dv) > EPS) return dv;
    for (const t of def.tiebreak) {
      const d = t(y) - t(x);
      if (Math.abs(d) > EPS) return d;
    }
    return nameOf(x.playerId).localeCompare(nameOf(y.playerId));
  });

  const rows: LeaderboardRow[] = [];
  eligible.forEach((s, i) => {
    const v = def.value(s);
    const prev = rows[i - 1];
    const tiedWithPrev = prev !== undefined && Math.abs(prev.value - v) <= EPS;
    const rank = tiedWithPrev ? prev.rank : i + 1;
    if (tiedWithPrev) prev.tied = true;
    rows.push({ rank, tied: tiedWithPrev, value: v, stats: s });
  });
  return rows;
}

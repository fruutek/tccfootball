/**
 * THE statistics engine.
 *
 * Nothing about a player's record is ever stored. Every number on the site and
 * every number the CLI reports is derived here, from match documents alone.
 * That is what keeps the records consistent: there is exactly one source of
 * truth (the matches) and exactly one function that interprets it.
 *
 * Team membership is per match, so players can change sides every week and the
 * numbers are still right.
 */
import { matchLines, outcomeOf } from './events';
import type { Match, Player, TeamKey } from './schema';
import { inPeriod, type Period } from './seasons';

export type Result = 'W' | 'D' | 'L';

export interface PlayerMatchEntry {
  matchId: string;
  date: string;
  team: TeamKey;
  teamName: string;
  opponentName: string;
  goalsFor: number;
  goalsAgainst: number;
  result: Result;
  goals: number;
  assists: number;
  ownGoals: number;
  potm: boolean;
}

export interface PlayerStats {
  playerId: string;
  /**
   * Appearances in RECORDED matches. This is the denominator for wins, draws, losses and win %,
   * so preseason games (which have no recorded result) never dilute them.
   */
  appearances: number;
  /** Everything counts: recorded appearances + preseason games. This is the "Apps" figure people see. */
  totalAppearances: number;
  /** All-time goals INCLUDE `startingGoals`. */
  goals: number;
  assists: number;
  /** Carried over from before match records began (all-time view only). */
  startingAppearances: number;
  startingGoals: number;
  startingAssists: number;
  ownGoals: number;
  goalContributions: number;
  wins: number;
  draws: number;
  losses: number;
  /** 0–100, unrounded. 0 when the player has no appearances. */
  winPct: number;
  goalsPerGame: number;
  assistsPerGame: number;
  potm: number;
  /** Consecutive wins ending at the player's most recent appearance. */
  currentWinStreak: number;
  longestWinStreak: number;
  /** Most recent first, length ≤ formLength. */
  form: Result[];
  firstAppearance: string | null;
  lastAppearance: string | null;
  /** Most recent first. */
  history: PlayerMatchEntry[];
}

export interface StartingTotals {
  appearances?: number | undefined;
  goals?: number | undefined;
  assists?: number | undefined;
}

export interface StatsOptions {
  period?: Period;
  seasonStartMonth?: number;
  formLength?: number;
  /** Pre-tracking totals per player. Applied ONLY to the all-time view: their dates are unknown. */
  startingTotals?: ReadonlyMap<string, StartingTotals>;
}

/** Collects every player's starting totals, ready for `computeStats`. */
export function startingTotalsOf(players: readonly Pick<Player, 'id' | 'startingTotals'>[]): Map<string, StartingTotals> {
  const map = new Map<string, StartingTotals>();
  for (const p of players) if (p.startingTotals) map.set(p.id, p.startingTotals);
  return map;
}

/** Chronological order: by date, then by id (so "-2" follows the first game that day). */
export function compareMatches(a: Pick<Match, 'date' | 'id'>, b: Pick<Match, 'date' | 'id'>): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Published matches inside the period, oldest first. Unpublished matches never count, and neither do
 * preseason results (no line-ups: those games are carried by players' `startingTotals`).
 */
export function matchesForPeriod(
  matches: readonly Match[],
  period: Period = { kind: 'all' },
  seasonStartMonth = 1,
): Match[] {
  return matches
    .filter((m) => m.status === 'published' && !m.preseason && inPeriod(m.date, period, seasonStartMonth))
    .sort(compareMatches);
}

export function emptyStats(playerId: string): PlayerStats {
  return {
    playerId,
    appearances: 0,
    totalAppearances: 0,
    goals: 0,
    assists: 0,
    startingAppearances: 0,
    startingGoals: 0,
    startingAssists: 0,
    ownGoals: 0,
    goalContributions: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    winPct: 0,
    goalsPerGame: 0,
    assistsPerGame: 0,
    potm: 0,
    currentWinStreak: 0,
    longestWinStreak: 0,
    form: [],
    firstAppearance: null,
    lastAppearance: null,
    history: [],
  };
}

/** Stats for every player who appears in at least one qualifying match. */
export function computeStats(matches: readonly Match[], opts: StatsOptions = {}): Map<string, PlayerStats> {
  const formLength = opts.formLength ?? 5;
  const ordered = matchesForPeriod(matches, opts.period, opts.seasonStartMonth);
  const byPlayer = new Map<string, PlayerMatchEntry[]>();

  for (const m of ordered) {
    const outcome = outcomeOf(m.score);
    for (const line of matchLines(m)) {
      const opp: TeamKey = line.team === 'a' ? 'b' : 'a';
      const result: Result = outcome === 'draw' ? 'D' : outcome === line.team ? 'W' : 'L';
      const entry: PlayerMatchEntry = {
        matchId: m.id,
        date: m.date,
        team: line.team,
        teamName: m.teams[line.team].name,
        opponentName: m.teams[opp].name,
        goalsFor: m.score[line.team],
        goalsAgainst: m.score[opp],
        result,
        goals: line.goals,
        assists: line.assists,
        ownGoals: line.ownGoals,
        potm: line.potm,
      };
      const list = byPlayer.get(line.playerId);
      if (list) list.push(entry);
      else byPlayer.set(line.playerId, [entry]);
    }
  }

  const out = new Map<string, PlayerStats>();
  for (const [playerId, chronological] of byPlayer) {
    const s = emptyStats(playerId);
    let streak = 0;
    for (const e of chronological) {
      s.appearances++;
      s.goals += e.goals;
      s.assists += e.assists;
      s.ownGoals += e.ownGoals;
      if (e.potm) s.potm++;
      if (e.result === 'W') {
        s.wins++;
        streak++;
        s.longestWinStreak = Math.max(s.longestWinStreak, streak);
      } else {
        streak = 0;
        if (e.result === 'D') s.draws++;
        else s.losses++;
      }
    }
    s.totalAppearances = s.appearances;
    s.currentWinStreak = streak;
    s.goalContributions = s.goals + s.assists;
    s.winPct = (s.wins / s.appearances) * 100;
    s.goalsPerGame = s.goals / s.appearances;
    s.assistsPerGame = s.assists / s.appearances;
    s.firstAppearance = chronological[0]!.date;
    s.lastAppearance = chronological[chronological.length - 1]!.date;
    s.history = [...chronological].reverse();
    s.form = s.history.slice(0, formLength).map((e) => e.result);
    out.set(playerId, s);
  }

  // Starting (preseason) totals join the ALL-TIME view only: their dates are unknown.
  //  • appearances/goals/assists add to the headline totals;
  //  • wins, draws, losses and win % stay RECORDED-matches-only — preseason has no tracked results;
  //  • per-game rates divide goals by games ONLY when the totals came as a pair, so goals recorded
  //    without games (or vice-versa) can never inflate or dilute an average.
  const allTime = (opts.period?.kind ?? 'all') === 'all';
  if (allTime && opts.startingTotals) {
    for (const [playerId, st] of opts.startingTotals) {
      const n = st.appearances ?? 0;
      const g = st.goals ?? 0;
      const a = st.assists ?? 0;
      if (n === 0 && g === 0 && a === 0) continue;
      const s = out.get(playerId) ?? emptyStats(playerId);
      const recordedGoals = s.goals;
      const recordedAssists = s.assists;
      s.startingAppearances = n;
      s.startingGoals = g;
      s.startingAssists = a;
      s.totalAppearances = s.appearances + n;
      s.goals += g;
      s.assists += a;
      s.goalContributions = s.goals + s.assists;
      const games = s.totalAppearances;
      s.goalsPerGame = games ? (recordedGoals + (n > 0 ? g : 0)) / games : 0;
      s.assistsPerGame = games ? (recordedAssists + (n > 0 ? a : 0)) / games : 0;
      out.set(playerId, s);
    }
  }
  return out;
}

export function statsFor(map: ReadonlyMap<string, PlayerStats>, playerId: string): PlayerStats {
  return map.get(playerId) ?? emptyStats(playerId);
}

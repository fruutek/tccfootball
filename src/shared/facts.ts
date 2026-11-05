/**
 * Fact sheets: everything that is TRUE about a match or a week, computed from
 * recorded data only. Report and roundup writers (humans or Claude) take their
 * facts from here and add only colour — never new facts.
 *
 * `statements` are ready-to-use sentences, each verified by construction.
 */
import { formatLongDate, weekdayName, addDays } from './dates';
import { accountGoals, outcomeOf } from './events';
import { buildLeaderboard, LEADERBOARDS, type LeaderboardKey } from './leaderboards';
import type { Match, MatchEvent, Player, TeamKey } from './schema';
import { seasonIdOf, seasonLabel } from './seasons';
import { compareMatches, computeStats, matchesForPeriod, startingTotalsOf, statsFor, type PlayerStats } from './stats';

export interface FactOptions {
  seasonStartMonth?: number;
  minAppearances?: number;
}

const GOAL_MILESTONES = [5, 10, 20, 25, 30, 40, 50, 75, 100, 150, 200];
const ASSIST_MILESTONES = [5, 10, 20, 25, 50, 75, 100];
const APPEARANCE_MILESTONES = [5, 10, 20, 25, 50, 75, 100, 150, 200];

const ordinal = (n: number) => {
  const v = n % 100;
  const suffix = ['th', 'st', 'nd', 'rd'][(v - 20) % 10] ?? ['th', 'st', 'nd', 'rd'][v] ?? 'th';
  return `${n}${suffix}`;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface PlayerFact {
  playerId: string;
  name: string;
  team: string;
  goals: number;
  assists: number;
  ownGoals: number;
  potm: boolean;
  debut: boolean;
  hatTrick: boolean;
  /** Totals AFTER this match (as of this match chronologically). */
  careerGoals: number;
  careerAssists: number;
  careerAppearances: number;
  seasonGoals: number;
  winStreak: number;
  milestones: string[];
}

export interface MatchFacts {
  matchId: string;
  date: string;
  dateLong: string;
  weekday: string;
  venue: string | null;
  season: string;
  teams: { key: TeamKey; name: string; colour: string; score: number; players: string[] }[];
  result: { winner: TeamKey | 'draw'; winnerName: string | null; margin: number; totalGoals: number; line: string };
  scorers: { player: string; goals: number; minutes: number[] }[];
  ownGoals: { player: string | null; creditedTo: string; minute?: number }[];
  unknownScorerGoals: { team: string; count: number }[];
  assists: { player: string; assists: number }[];
  linkedAssists: string[];
  playerOfTheMatch: string | null;
  players: PlayerFact[];
  records: string[];
  standings: {
    topScorersSeason: { player: string; goals: number }[];
    topScorersAllTime: { player: string; goals: number }[];
    topAssistsSeason: { player: string; assists: number }[];
  };
  /** Pre-verified sentences. Safe to quote or paraphrase; do not embellish. */
  statements: string[];
  /** Things that are NOT recorded and must not be written about as if known. */
  notRecorded: string[];
}

export function buildMatchFacts(
  matchId: string,
  allMatches: readonly Match[],
  players: readonly Player[],
  opts: FactOptions = {},
): MatchFacts {
  const startMonth = opts.seasonStartMonth ?? 1;
  const published = allMatches.filter((m) => m.status === 'published').sort(compareMatches);
  const match = published.find((m) => m.id === matchId);
  if (!match) throw new Error(`Match "${matchId}" is not among the published matches.`);

  const nameOf = (id: string | null) => (id === null ? 'an unknown player' : players.find((p) => p.id === id)?.displayName ?? id);
  const season = seasonIdOf(match.date, startMonth);
  const upTo = published.filter((m) => compareMatches(m, match) <= 0);
  const before = published.filter((m) => compareMatches(m, match) < 0);

  // Career figures are the all-time ones the site shows, so they include any pre-tracking starting totals.
  const startingTotals = startingTotalsOf(players);
  const careerNow = computeStats(upTo, { startingTotals });
  const careerBefore = computeStats(before, { startingTotals });
  const seasonNow = computeStats(upTo, { period: { kind: 'season', id: season }, seasonStartMonth: startMonth });

  const { a, b } = match.teams;
  const outcome = outcomeOf(match.score);
  const margin = Math.abs(match.score.a - match.score.b);
  const totalGoals = match.score.a + match.score.b;
  const winnerName = outcome === 'draw' ? null : match.teams[outcome].name;
  const line = `${a.name} ${match.score.a}–${match.score.b} ${b.name}`;

  /* scorers / assists ------------------------------------------------------ */
  const scorerMap = new Map<string, { goals: number; minutes: number[] }>();
  const assistMap = new Map<string, number>();
  const linkedAssists: string[] = [];
  const ownGoals: MatchFacts['ownGoals'] = [];
  for (const e of match.events as MatchEvent[]) {
    if (e.type === 'goal') {
      if (e.playerId) {
        const s = scorerMap.get(e.playerId) ?? { goals: 0, minutes: [] };
        s.goals++;
        if (e.minute !== undefined) s.minutes.push(e.minute);
        scorerMap.set(e.playerId, s);
      }
      if (e.assistId) {
        assistMap.set(e.assistId, (assistMap.get(e.assistId) ?? 0) + 1);
        linkedAssists.push(`${nameOf(e.playerId)} (assist: ${nameOf(e.assistId)})${e.minute !== undefined ? ` ${e.minute}'` : ''}`);
      }
    } else if (e.type === 'own_goal') {
      ownGoals.push({ player: e.playerId ? nameOf(e.playerId) : null, creditedTo: match.teams[e.team].name, ...(e.minute !== undefined ? { minute: e.minute } : {}) });
    } else if (e.type === 'assist') {
      assistMap.set(e.playerId, (assistMap.get(e.playerId) ?? 0) + 1);
    }
  }
  const acc = accountGoals(match);
  const unknownScorerGoals = (['a', 'b'] as const)
    .filter((k) => acc[k].unknownGoals > 0)
    .map((k) => ({ team: match.teams[k].name, count: acc[k].unknownGoals }));

  /* per-player facts ---------------------------------------------------------- */
  const playerFacts: PlayerFact[] = [];
  for (const k of ['a', 'b'] as const) {
    for (const pid of match.teams[k].playerIds) {
      const now = statsFor(careerNow, pid);
      const prev = statsFor(careerBefore, pid);
      const entry = now.history[0]; // this match is the player's latest entry as-of this match
      const goals = entry?.goals ?? 0;
      const assists = entry?.assists ?? 0;
      const milestones: string[] = [];
      for (const t of GOAL_MILESTONES) if (prev.goals < t && now.goals >= t) milestones.push(`${ordinal(t)} career goal`);
      for (const t of ASSIST_MILESTONES) if (prev.assists < t && now.assists >= t) milestones.push(`${ordinal(t)} career assist`);
      for (const t of APPEARANCE_MILESTONES) if (prev.totalAppearances < t && now.totalAppearances >= t) milestones.push(`${ordinal(t)} appearance`);
      playerFacts.push({
        playerId: pid,
        name: nameOf(pid),
        team: match.teams[k].name,
        goals,
        assists,
        ownGoals: entry?.ownGoals ?? 0,
        potm: match.playerOfTheMatch === pid,
        debut: now.totalAppearances === 1, // preseason games count: a regular is never a "debutant"
        hatTrick: goals >= 3,
        careerGoals: now.goals,
        careerAssists: now.assists,
        careerAppearances: now.totalAppearances,
        seasonGoals: statsFor(seasonNow, pid).goals,
        winStreak: now.currentWinStreak,
        milestones,
      });
    }
  }

  /* records ------------------------------------------------------------------ */
  const records: string[] = [];
  const prevMargins = before.map((m) => Math.abs(m.score.a - m.score.b));
  const prevTotals = before.map((m) => m.score.a + m.score.b);
  if (before.length >= 3) {
    if (margin > 0 && margin > Math.max(...prevMargins)) records.push(`A ${margin}-goal margin is the biggest winning margin on record (previous best: ${Math.max(...prevMargins)}).`);
    if (totalGoals > Math.max(...prevTotals)) records.push(`${totalGoals} goals is the highest-scoring match on record (previous best: ${Math.max(...prevTotals)}).`);
  }
  const boardNow = leader(careerNow, 'goals');
  const boardBefore = leader(careerBefore, 'goals');
  if (boardNow && boardBefore && boardNow.id !== boardBefore.id && boardNow.value > boardBefore.value) {
    records.push(`${nameOf(boardNow.id)} moved to the top of the all-time scoring chart with ${boardNow.value} goals, overtaking ${nameOf(boardBefore.id)}.`);
  }

  /* standings ------------------------------------------------------------------ */
  const top = (map: Map<string, PlayerStats>, key: LeaderboardKey) =>
    buildLeaderboard(map.values(), key, { minAppearances: 1, nameOf })
      .slice(0, 3)
      .map((r) => ({ player: nameOf(r.stats.playerId), value: r.value }));
  const standings = {
    topScorersSeason: top(seasonNow, 'goals').map((r) => ({ player: r.player, goals: r.value })),
    topScorersAllTime: top(careerNow, 'goals').map((r) => ({ player: r.player, goals: r.value })),
    topAssistsSeason: top(seasonNow, 'assists').map((r) => ({ player: r.player, assists: r.value })),
  };

  /* statements --------------------------------------------------------------------- */
  const statements: string[] = [];
  statements.push(
    `${weekdayName(match.date)} ${formatLongDate(match.date)}: ${line}${outcome === 'draw' ? ' (a draw)' : `, a ${margin}-goal win for ${winnerName}`}.`,
  );
  for (const [pid, s] of [...scorerMap].sort((x, y) => y[1].goals - x[1].goals)) {
    statements.push(`${nameOf(pid)} scored ${plural(s.goals, 'goal')}${s.minutes.length ? ` (${s.minutes.map((m) => `${m}'`).join(', ')})` : ''}.`);
  }
  for (const o of ownGoals) statements.push(`${o.player ?? 'An unidentified player'} scored an own goal, which counted for ${o.creditedTo}.`);
  for (const u of unknownScorerGoals) statements.push(`${plural(u.count, 'goal')} for ${u.team} came from a scorer who was not recorded.`);
  for (const [pid, n] of assistMap) statements.push(`${nameOf(pid)} ${n === 1 ? 'provided an assist' : `provided ${n} assists`}.`);
  if (match.playerOfTheMatch) statements.push(`${nameOf(match.playerOfTheMatch)} was named player of the match.`);
  for (const p of playerFacts) {
    if (p.hatTrick) statements.push(`${p.name} scored a hat-trick${p.goals > 3 ? ` (${p.goals} goals)` : ''}.`);
    if (p.debut) statements.push(`It was ${p.name}'s first appearance.`);
    for (const m of p.milestones) statements.push(`${p.name} reached a milestone: ${m}.`);
    if (p.winStreak >= 3) statements.push(`${p.name} has now won ${p.winStreak} matches in a row.`);
  }
  statements.push(...records);
  const lead = standings.topScorersSeason[0];
  if (lead) statements.push(`${lead.player} leads the ${seasonLabel(season)} scoring chart with ${plural(lead.goals, 'goal')}.`);

  return {
    matchId: match.id,
    date: match.date,
    dateLong: formatLongDate(match.date),
    weekday: weekdayName(match.date),
    venue: match.venue ?? null,
    season: seasonLabel(season),
    teams: (['a', 'b'] as const).map((k) => ({
      key: k,
      name: match.teams[k].name,
      colour: match.teams[k].colour,
      score: match.score[k],
      players: match.teams[k].playerIds.map(nameOf),
    })),
    result: { winner: outcome, winnerName, margin, totalGoals, line },
    scorers: [...scorerMap].map(([pid, s]) => ({ player: nameOf(pid), ...s })).sort((x, y) => y.goals - x.goals),
    ownGoals,
    unknownScorerGoals,
    assists: [...assistMap].map(([pid, n]) => ({ player: nameOf(pid), assists: n })).sort((x, y) => y.assists - x.assists),
    linkedAssists,
    playerOfTheMatch: match.playerOfTheMatch ? nameOf(match.playerOfTheMatch) : null,
    players: playerFacts,
    records,
    standings,
    statements,
    notRecorded: [
      'Minute-by-minute action, shots, saves, cards, injuries and weather are not recorded.',
      'Individual positions and formations are not recorded.',
      ...(match.venue ? [] : ['The venue was not recorded.']),
      ...(match.events.some((e) => 'minute' in e && e.minute !== undefined) ? [] : ['Goal times were not recorded.']),
      ...(match.playerOfTheMatch ? [] : ['No player of the match was named.']),
    ],
  };
}

function leader(map: Map<string, PlayerStats>, key: LeaderboardKey) {
  const rows = buildLeaderboard(map.values(), key, { minAppearances: 1 });
  const top = rows[0];
  if (!top || rows[1]?.rank === 1) return null; // no outright leader
  return { id: top.stats.playerId, value: top.value };
}

/* ------------------------------------------------------------------ weekly */

export interface RoundupFacts {
  from: string;
  to: string;
  matches: { id: string; line: string; date: string; potm: string | null; scorers: string[] }[];
  topPerformers: { player: string; goals: number; assists: number; potm: number; wins: number }[];
  leaderboards: Record<string, { rank: number; player: string; value: string }[]>;
  streaks: { player: string; streak: number }[];
  seasonLabel: string;
  statements: string[];
  nextFixture: string | null;
}

/** Facts for the week containing `date` (Monday–Sunday). */
export function buildRoundupFacts(
  weekOf: string,
  allMatches: readonly Match[],
  players: readonly Player[],
  nextFixture: { date: string; kickoff?: string; venue?: string } | null,
  opts: FactOptions = {},
): RoundupFacts {
  const startMonth = opts.seasonStartMonth ?? 1;
  const wd = new Date(`${weekOf}T00:00:00Z`).getUTCDay();
  const from = addDays(weekOf, -((wd + 6) % 7));
  const to = addDays(from, 6);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.displayName ?? id;
  const published = allMatches.filter((m) => m.status === 'published');
  const week = published.filter((m) => m.date >= from && m.date <= to).sort(compareMatches);
  const asOf = published.filter((m) => m.date <= to);
  const season = seasonIdOf(to, startMonth);
  const seasonStats = computeStats(asOf, { period: { kind: 'season', id: season }, seasonStartMonth: startMonth });
  const weekStats = computeStats(week);

  const lbs: RoundupFacts['leaderboards'] = {};
  for (const key of ['goals', 'assists', 'wins', 'winStreak'] as const) {
    lbs[LEADERBOARDS[key].label] = buildLeaderboard(seasonStats.values(), key, { minAppearances: 1, nameOf })
      .slice(0, 5)
      .map((r) => ({ rank: r.rank, player: nameOf(r.stats.playerId), value: LEADERBOARDS[key].format(r.value) }));
  }

  const matches = week.map((m) => {
    const f = buildMatchFacts(m.id, published, players, opts);
    return {
      id: m.id,
      date: m.date,
      line: f.result.line,
      potm: f.playerOfTheMatch,
      scorers: f.scorers.map((s) => `${s.player}${s.goals > 1 ? ` ×${s.goals}` : ''}`),
    };
  });

  const topPerformers = [...weekStats.values()]
    .map((s) => ({ player: nameOf(s.playerId), goals: s.goals, assists: s.assists, potm: s.potm, wins: s.wins }))
    .filter((p) => p.goals + p.assists + p.potm > 0)
    .sort((x, y) => y.goals - x.goals || y.assists - x.assists || y.potm - x.potm)
    .slice(0, 5);

  const allStats = computeStats(asOf);
  const streaks = [...allStats.values()]
    .filter((s) => s.currentWinStreak >= 3)
    .sort((x, y) => y.currentWinStreak - x.currentWinStreak)
    .map((s) => ({ player: nameOf(s.playerId), streak: s.currentWinStreak }));

  const statements: string[] = [];
  if (week.length === 0) statements.push(`No match was recorded between ${formatLongDate(from)} and ${formatLongDate(to)}.`);
  for (const m of matches) statements.push(`${m.line} (${m.date}).${m.potm ? ` Player of the match: ${m.potm}.` : ''}`);
  const leadGoals = lbs['Top scorers']?.[0];
  if (leadGoals) statements.push(`${leadGoals.player} leads the ${seasonLabel(season)} scoring chart on ${leadGoals.value}.`);
  for (const s of streaks.slice(0, 3)) statements.push(`${s.player} is on a ${s.streak}-match winning streak.`);

  return {
    from,
    to,
    matches,
    topPerformers,
    leaderboards: lbs,
    streaks,
    seasonLabel: seasonLabel(season),
    statements,
    nextFixture: nextFixture ? `${weekdayName(nextFixture.date)} ${formatLongDate(nextFixture.date)}${nextFixture.kickoff ? ` at ${nextFixture.kickoff}` : ''}${nextFixture.venue ? `, ${nextFixture.venue}` : ''}` : null,
  };
}

export { matchesForPeriod };

/**
 * Preseason RESULTS: date + score + scorers, no line-ups. They are shown on the Results and match pages but
 * count towards no statistic — those games are carried by each player's startingTotals.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../cli/store';
import { execute } from '../cli/services/execute';
import { auditData } from '../cli/services/integrity';
import { planEditMatch, planMatchStatus, planPublishMatch } from '../cli/services/matches';
import { planAddPlayer } from '../cli/services/players';
import { matchToSpec } from '../cli/spec';
import { matchSchema } from '../src/shared/schema';
import { buildLeaderboard } from '../src/shared/leaderboards';
import { matchesForPeriod, startingTotalsOf, computeStats, statsFor } from '../src/shared/stats';
import { validateMatchContent } from '../src/shared/validate';
import type { Ctx } from '../cli/types';
import { goal, mkMatch } from './helpers';

const ctx: Ctx = { now: new Date('2026-11-05T10:00:00Z'), today: '2026-11-05', actor: 'test' };

let store: MemoryStore;
beforeEach(async () => {
  store = new MemoryStore();
  const roster: [string, { goals: number; appearances: number } | undefined, string[]?][] = [
    ['Peter', { appearances: 4, goals: 3 }],
    ['KJ', { appearances: 4, goals: 3 }],
    ['Andrew', { appearances: 4, goals: 2 }],
    ['Dan W', { appearances: 3, goals: 2 }],
    ['Katie', { appearances: 3, goals: 1 }],
    ['Jamie', { appearances: 4, goals: 1 }],
    ['Antony', { appearances: 4, goals: 1 }, ['Ant']],
  ];
  for (const [name, startingTotals, aliases] of roster) {
    const plan = planAddPlayer(await store.load(), { name, startingTotals, ...(aliases ? { aliases } : {}) }, ctx);
    expect(plan.ok, JSON.stringify(plan.errors)).toBe(true);
    await execute(store, plan, ctx, true);
  }
});

const noLineups = { a: { name: 'Team 1' }, b: { name: 'Team 2' } };
const week1 = () => ({
  date: '2026-10-12',
  preseason: true,
  teams: noLineups,
  score: { a: 4, b: 1 },
  events: [
    { type: 'goal', player: 'Katie', team: 'a' },
    { type: 'goal', player: 'Jamie', team: 'a' },
    { type: 'goal', player: 'Ant', team: 'a' },
    { type: 'goal', player: null, team: 'a' },
    { type: 'goal', player: 'Andrew', team: 'b' },
  ],
});
const week2 = () => ({
  date: '2026-10-19',
  preseason: true,
  teams: noLineups,
  score: { a: 5, b: 0 },
  events: [
    { type: 'goal', player: 'Peter', team: 'a' },
    { type: 'goal', player: 'Andrew', team: 'a' },
    { type: 'goal', player: 'Dan W', team: 'a', count: 2 },
    { type: 'goal', player: 'KJ', team: 'a' },
  ],
});

const publish = async (spec: unknown, apply = true) => {
  const plan = planPublishMatch(await store.load(), spec, ctx);
  return { plan, out: await execute(store, plan, ctx, apply) };
};

describe('validation', () => {
  const base = () => mkMatch({ a: [], b: [], score: [1, 0], events: [goal('a', 'peter')] });

  it('refuses empty line-ups on a normal match', () => {
    expect(validateMatchContent(base()).errors.map((e) => e.code)).toContain('TEAM_EMPTY');
  });

  it('accepts a preseason result with no line-ups, and does not check scorers against rosters', () => {
    const r = validateMatchContent({ ...base(), preseason: true }, { knownPlayerIds: new Set(['peter']) });
    expect(r.errors).toEqual([]);
  });

  it('still refuses scores that the scorers do not add up to', () => {
    const r = validateMatchContent({ ...base(), score: { a: 2, b: 0 }, preseason: true });
    expect(r.errors.map((e) => e.code)).toContain('GOALS_UNACCOUNTED');
  });

  it('refuses line-ups and a player of the match, which a preseason result cannot have', () => {
    const lineup = validateMatchContent({ ...mkMatch({ score: [1, 0], events: [goal('a', 'peter')] }), preseason: true });
    expect(lineup.errors.map((e) => e.code)).toContain('PRESEASON_HAS_LINEUP');
    const potm = validateMatchContent({ ...base(), preseason: true, playerOfTheMatch: 'peter' });
    expect(potm.errors.map((e) => e.code)).toContain('PRESEASON_NO_POTM');
  });

  it('refuses a scorer id that does not exist', () => {
    const r = validateMatchContent({ ...base(), preseason: true }, { knownPlayerIds: new Set(['someone-else']) });
    expect(r.errors.map((e) => e.code)).toContain('PLAYER_UNKNOWN');
  });
});

describe('statistics are untouched', () => {
  it('matchesForPeriod and computeStats ignore preseason results entirely', () => {
    const m = { ...mkMatch({ a: [], b: [], score: [1, 0], events: [goal('a', 'peter')] }), preseason: true as const };
    const real = mkMatch({ date: '2026-11-02', a: ['peter'], b: ['tom'], score: [1, 0], events: [goal('a', 'peter')] });
    expect(matchesForPeriod([m, real]).map((x) => x.id)).toEqual(['2026-11-02']);
    const stats = computeStats([m, real]);
    expect(statsFor(stats, 'peter')).toMatchObject({ appearances: 1, goals: 1 });
    expect(computeStats([m]).size).toBe(0);
  });

  it('publishing the four games changes no player statistic or leaderboard', async () => {
    const before = await store.load();
    const players = before.players;
    const startingTotals = startingTotalsOf(players);
    const board = (matches: typeof before.matches) =>
      buildLeaderboard(computeStats(matches, { startingTotals }).values(), 'goals', { minAppearances: 5 }).map((r) => [r.rank, r.stats.playerId, r.value]);
    const boardBefore = board(before.matches);
    expect(boardBefore.length).toBeGreaterThan(0);

    const { plan } = await publish(week1());
    expect(plan.errors).toEqual([]);
    expect(plan.details.statChanges).toEqual([]);
    await publish(week2());

    const after = await store.load();
    expect(after.matches).toHaveLength(2);
    expect(board(after.matches)).toEqual(boardBefore);
    const peter = statsFor(computeStats(after.matches, { startingTotals }), 'peter');
    expect(peter).toMatchObject({ goals: 3, appearances: 0, totalAppearances: 4, wins: 0 });
  });
});

describe('publishing a preseason result', () => {
  it('stores the date, teams, score and scorers with explicit sides — and no line-ups', async () => {
    const { plan, out } = await publish(week1());
    expect(plan.errors).toEqual([]);
    expect(out.applied).toBe(true);
    expect(plan.details.facts).toBeNull();
    // No "write a match report" nag for a game that has no line-ups to report on.
    expect(plan.warnings.map((w) => w.code)).not.toContain('NO_REPORT');

    const m = (await store.load()).matches[0]!;
    expect(m).toMatchObject({ id: '2026-10-12', status: 'published', preseason: true, score: { a: 4, b: 1 }, playerIds: [], playerOfTheMatch: null });
    expect(m.teams.a).toMatchObject({ name: 'Team 1', playerIds: [] });
    expect(m.events.filter((e) => e.team === 'a').map((e) => (e.type === 'goal' ? e.playerId : 'x'))).toEqual(['katie', 'jamie', 'antony', null]);
    expect(m.events.filter((e) => e.team === 'b').map((e) => (e.type === 'goal' ? e.playerId : 'x'))).toEqual(['andrew']);
    expect(matchSchema.safeParse(m).success).toBe(true);
  });

  it('is a dry run unless applied', async () => {
    const { out } = await publish(week1(), false);
    expect(out.applied).toBe(false);
    expect((await store.load()).matches).toHaveLength(0);
  });

  it('asks which side each goal counts for, because there is no roster to infer it from', async () => {
    const spec = week1();
    delete (spec.events[0] as { team?: string }).team;
    const { plan } = await publish(spec, false);
    expect(plan.errors.map((e) => e.code)).toContain('EVENT_TEAM_REQUIRED');
  });

  it('refuses a score the named scorers do not add up to', async () => {
    const spec = week1();
    spec.events.pop(); // Team 2 scored 1 but nobody is named
    const { plan } = await publish(spec, false);
    expect(plan.errors.map((e) => e.code)).toContain('GOALS_UNACCOUNTED');
  });

  it('refuses line-ups, and a match report', async () => {
    const withLineup = { ...week1(), teams: { a: { name: 'Team 1', players: ['Peter'] }, b: { name: 'Team 2' } } };
    expect((await publish(withLineup, false)).plan.errors.map((e) => e.code)).toContain('PRESEASON_HAS_LINEUP');
    const withReport = { ...week1(), report: { title: 'T', standfirst: 'S', body: 'B' } };
    expect((await publish(withReport, false)).plan.errors.map((e) => e.code)).toContain('PRESEASON_NO_REPORT');
  });

  it('still blocks a second result on the same date and an identical result', async () => {
    await publish(week1());
    expect((await publish(week1(), false)).plan.errors.map((e) => e.code)).toContain('MATCH_EXISTS');
    // The same result a week later is most likely a mistyped date: warned about, not silently accepted.
    const sameResultOtherDay = await publish({ ...week1(), date: '2026-10-19' }, false);
    expect(sameResultOtherDay.plan.errors).toEqual([]);
    expect(sameResultOtherDay.plan.warnings.map((w) => w.code)).toContain('POSSIBLE_DUPLICATE');
  });

  it('recognises the same result with the sides swapped, but not a different one', async () => {
    const oneNil = { date: '2026-10-26', preseason: true, teams: noLineups, score: { a: 1, b: 0 }, events: [{ type: 'goal', player: 'Peter', team: 'a' }] };
    const flipped = { date: '2026-11-02', preseason: true, teams: noLineups, score: { a: 0, b: 1 }, events: [{ type: 'goal', player: 'Peter', team: 'b' }] };
    await publish(oneNil);
    // Same scorer, same score with the sides swapped → the same result, whichever team is called "a".
    const swapped = await publish(flipped, false);
    expect(swapped.plan.errors).toEqual([]);
    expect(swapped.plan.warnings.map((w) => w.code)).toContain('POSSIBLE_DUPLICATE');
    const different = { ...flipped, score: { a: 0, b: 2 }, events: [{ type: 'goal', player: 'Peter', team: 'b', count: 2 }] };
    const other = await publish(different, false);
    expect(other.plan.errors).toEqual([]);
    expect(other.plan.warnings.map((w) => w.code)).not.toContain('POSSIBLE_DUPLICATE');
  });
});

describe('editing, hiding and auditing', () => {
  it('round-trips through "match show --spec" and keeps the flag and the explicit teams', async () => {
    await publish(week2());
    const snap = await store.load();
    const spec = matchToSpec(snap.matches[0]!, snap.players);
    expect(spec).toMatchObject({ preseason: true });
    expect(spec.events.every((e) => 'team' in e && e.team === 'a')).toBe(true);
    // Unchanged spec = nothing to do; a corrected score is applied.
    expect(planEditMatch(snap, '2026-10-19', spec, ctx).errors.map((e) => e.code)).toContain('NO_CHANGES');
    const fixed = { ...spec, date: '2026-10-20' };
    const plan = planEditMatch(snap, '2026-10-19', fixed, ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.details.changes[0]).toContain('date 2026-10-19 → 2026-10-20');
    await execute(store, plan, ctx, true);
    expect((await store.load()).matches[0]).toMatchObject({ id: '2026-10-19', date: '2026-10-20', preseason: true });
  });

  it('can be hidden and restored like any result', async () => {
    await publish(week2());
    const hide = planMatchStatus(await store.load(), '2026-10-19', 'unpublish', ctx);
    expect(hide.errors).toEqual([]);
    await execute(store, hide, ctx, true);
    expect((await store.load()).matches[0]!.status).toBe('unpublished');
  });

  it('passes the audit, and reports whether the scorers agree with the preseason goals on the profiles', async () => {
    await publish(week1());
    await publish(week2());
    const report = auditData(await store.load(), ctx);
    expect(report.problems).toEqual([]);
    // Only weeks 1–2 are in: Peter's 3 profile goals are not all in these results.
    expect(report.notes.join('\n')).toMatch(/2 preseason result\(s\)[^]*Peter: 1 in the preseason results vs 3/);
    expect(report.totals.publishedMatches).toBe(0); // preseason results are not "matches" for statistics
  });

  it('says so when the results match the profiles exactly', async () => {
    const week3 = { date: '2026-10-26', preseason: true, teams: noLineups, score: { a: 1, b: 0 }, events: [{ type: 'goal', player: 'Peter', team: 'a' }] };
    const week4 = { date: '2026-11-02', preseason: true, teams: noLineups, score: { a: 2, b: 1 }, events: [{ type: 'goal', player: 'KJ', team: 'a', count: 2 }, { type: 'goal', player: 'Peter', team: 'b' }] };
    for (const spec of [week1(), week2(), week3, week4]) expect((await publish(spec)).plan.errors).toEqual([]);
    const report = auditData(await store.load(), ctx);
    expect(report.problems).toEqual([]);
    expect(report.notes.join('\n')).toContain('4 preseason result(s) shown on the Results page; their scorers match every player\'s preseason goals.');
  });
});

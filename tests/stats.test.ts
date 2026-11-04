import { describe, expect, it } from 'vitest';
import { buildLeaderboard, minAppearancesFor } from '../src/shared/leaderboards';
import { computeStats, matchesForPeriod, statsFor } from '../src/shared/stats';
import { addDays } from '../src/shared/dates';
import { assist, goal, mkMatch, ownGoal } from './helpers';

const stats = (m: ReturnType<typeof mkMatch>[], opts = {}) => computeStats(m, opts);

describe('goals and assists', () => {
  const m = mkMatch({
    a: ['peter', 'adam', 'james'],
    b: ['alex', 'tom', 'josh'],
    score: [3, 1],
    events: [
      goal('a', 'peter', { assistId: 'adam', minute: 4 }),
      goal('a', 'peter'),
      goal('a', 'james', { assistId: 'peter' }),
      goal('b', 'alex'),
    ],
  });

  it('credits goals to the scorer and assists to the provider', () => {
    const s = stats([m]);
    expect(statsFor(s, 'peter')).toMatchObject({ goals: 2, assists: 1, goalContributions: 3 });
    expect(statsFor(s, 'adam')).toMatchObject({ goals: 0, assists: 1 });
    expect(statsFor(s, 'james')).toMatchObject({ goals: 1, assists: 0 });
    expect(statsFor(s, 'alex')).toMatchObject({ goals: 1, assists: 0 });
    expect(statsFor(s, 'tom')).toMatchObject({ goals: 0, assists: 0 });
  });

  it('counts an assist that is not linked to a specific goal', () => {
    const unlinked = mkMatch({
      a: ['peter', 'adam'],
      b: ['alex', 'tom'],
      score: [2, 0],
      events: [goal('a', 'peter'), goal('a', 'peter'), assist('a', 'adam')],
    });
    const s = stats([unlinked]);
    expect(statsFor(s, 'adam').assists).toBe(1);
    expect(statsFor(s, 'peter').goals).toBe(2);
  });

  it('derives per-game averages from appearances', () => {
    const s = statsFor(stats([m, mkMatch({ date: '2026-01-12', a: ['peter'], b: ['alex'], score: [0, 0] })]), 'peter');
    expect(s.appearances).toBe(2);
    expect(s.goalsPerGame).toBe(1);
    expect(s.assistsPerGame).toBe(0.5);
  });
});

describe('appearances', () => {
  it('counts one appearance per match played and none for non-participants', () => {
    const matches = [
      mkMatch({ date: '2026-01-05', a: ['peter'], b: ['alex'] }),
      mkMatch({ date: '2026-01-12', a: ['peter'], b: ['tom'] }),
      mkMatch({ date: '2026-01-19', a: ['adam'], b: ['tom'] }),
    ];
    const s = stats(matches);
    expect(statsFor(s, 'peter').appearances).toBe(2);
    expect(statsFor(s, 'tom').appearances).toBe(2);
    expect(statsFor(s, 'josh').appearances).toBe(0);
    expect(statsFor(s, 'peter').firstAppearance).toBe('2026-01-05');
    expect(statsFor(s, 'peter').lastAppearance).toBe('2026-01-12');
  });

  it('ignores unpublished matches everywhere', () => {
    const s = stats([mkMatch({ status: 'unpublished', score: [1, 0], events: [goal('a', 'peter')] })]);
    expect(s.size).toBe(0);
  });
});

describe('wins, draws, losses', () => {
  const matches = [
    mkMatch({ date: '2026-01-05', a: ['peter'], b: ['alex'], score: [2, 1] }),
    mkMatch({ date: '2026-01-12', a: ['peter'], b: ['alex'], score: [1, 1] }),
    mkMatch({ date: '2026-01-19', a: ['peter'], b: ['alex'], score: [0, 3] }),
    mkMatch({ date: '2026-01-26', a: ['peter'], b: ['alex'], score: [4, 0] }),
  ];

  it('derives W/D/L, win percentage and form (newest first)', () => {
    const p = statsFor(stats(matches), 'peter');
    expect([p.wins, p.draws, p.losses]).toEqual([2, 1, 1]);
    expect(p.winPct).toBe(50);
    expect(p.form).toEqual(['W', 'L', 'D', 'W']);
    const a = statsFor(stats(matches), 'alex');
    expect([a.wins, a.draws, a.losses]).toEqual([1, 1, 2]);
  });

  it('limits form to the configured length', () => {
    expect(statsFor(stats(matches, { formLength: 3 }), 'peter').form).toEqual(['W', 'L', 'D']);
  });

  it('computes current and longest winning streaks', () => {
    const run = [
      mkMatch({ date: '2026-02-02', a: ['peter'], b: ['alex'], score: [1, 0] }),
      mkMatch({ date: '2026-02-09', a: ['peter'], b: ['alex'], score: [2, 0] }),
      mkMatch({ date: '2026-02-16', a: ['peter'], b: ['alex'], score: [0, 1] }),
      mkMatch({ date: '2026-02-23', a: ['peter'], b: ['alex'], score: [3, 0] }),
      mkMatch({ date: '2026-03-02', a: ['peter'], b: ['alex'], score: [1, 0] }),
    ];
    const p = statsFor(stats(run), 'peter');
    expect(p.currentWinStreak).toBe(2);
    expect(p.longestWinStreak).toBe(2);
    // Missing a week does not break a streak; a draw does.
    const withDraw = [...run, mkMatch({ date: '2026-03-09', a: ['peter'], b: ['alex'], score: [1, 1] })];
    expect(statsFor(stats(withDraw), 'peter').currentWinStreak).toBe(0);
  });
});

describe('switching teams', () => {
  it('attributes results to whichever side the player was on that week', () => {
    const matches = [
      mkMatch({ date: '2026-01-05', a: ['peter', 'adam'], b: ['alex', 'tom'], score: [2, 0], events: [goal('a', 'peter'), goal('a', 'adam')] }),
      // Peter is now on the Blue side — and they lose.
      mkMatch({ date: '2026-01-12', a: ['adam', 'tom'], b: ['peter', 'alex'], score: [3, 1], events: [goal('a', 'adam'), goal('a', 'adam'), goal('a', 'tom'), goal('b', 'peter')] }),
      // Third week, Peter and Adam are team-mates again, on the other colour.
      mkMatch({ date: '2026-01-19', a: ['alex', 'tom'], b: ['peter', 'adam'], score: [0, 1], events: [goal('b', 'peter')] }),
    ];
    const s = stats(matches);
    const peter = statsFor(s, 'peter');
    expect([peter.wins, peter.draws, peter.losses]).toEqual([2, 0, 1]);
    expect(peter.goals).toBe(3);
    expect(peter.history.map((h) => h.team)).toEqual(['b', 'b', 'a']);
    expect(peter.history.map((h) => h.result)).toEqual(['W', 'L', 'W']);
    const adam = statsFor(s, 'adam');
    // Adam won all three — he was on the winning side whichever colour he wore.
    expect([adam.wins, adam.losses]).toEqual([3, 0]);
    expect(adam.goals).toBe(3);
  });
});

describe('own goals', () => {
  const m = mkMatch({
    a: ['peter', 'adam'],
    b: ['alex', 'tom'],
    score: [2, 0],
    // Tom (Blue) puts one into his own net: counts for Red.
    events: [goal('a', 'peter'), ownGoal('a', 'tom')],
  });

  it('does not count an own goal as a goal for the scorer, but records it', () => {
    const s = stats([m]);
    expect(statsFor(s, 'tom')).toMatchObject({ goals: 0, ownGoals: 1 });
    expect(statsFor(s, 'peter').goals).toBe(1);
  });

  it("counts the own goal toward the opposition's result", () => {
    const s = stats([m]);
    expect(statsFor(s, 'adam').wins).toBe(1);
    expect(statsFor(s, 'tom').losses).toBe(1);
    expect(statsFor(s, 'tom').history[0]).toMatchObject({ goalsFor: 0, goalsAgainst: 2, ownGoals: 1 });
  });

  it('keeps own goals out of the scoring leaderboard', () => {
    const rows = buildLeaderboard(stats([m]).values(), 'goals', { minAppearances: 1 });
    expect(rows.map((r) => r.stats.playerId)).toEqual(['peter']);
  });
});

describe('unknown scorers', () => {
  it('credits no player with a goal whose scorer is unknown', () => {
    const m = mkMatch({ score: [2, 0], events: [goal('a', 'peter'), goal('a', null)] });
    const s = stats([m]);
    expect(statsFor(s, 'peter').goals).toBe(1);
    const totalGoals = [...s.values()].reduce((n, p) => n + p.goals, 0);
    expect(totalGoals).toBe(1); // the other goal belongs to nobody
    expect(statsFor(s, 'adam').wins).toBe(1); // …but the result still stands
  });
});

describe('player of the match', () => {
  it('counts awards', () => {
    const s = stats([
      mkMatch({ date: '2026-01-05', potm: 'peter' }),
      mkMatch({ date: '2026-01-12', potm: 'peter' }),
      mkMatch({ date: '2026-01-19', potm: 'alex' }),
    ]);
    expect(statsFor(s, 'peter').potm).toBe(2);
    expect(statsFor(s, 'alex').potm).toBe(1);
  });
});

describe('periods', () => {
  const matches = [
    mkMatch({ date: '2025-12-29', a: ['peter'], b: ['alex'], score: [1, 0], events: [goal('a', 'peter')] }),
    mkMatch({ date: '2026-01-05', a: ['peter'], b: ['alex'], score: [1, 0], events: [goal('a', 'peter')] }),
    mkMatch({ date: '2026-02-02', a: ['peter'], b: ['alex'], score: [0, 1] }),
  ];

  it('filters by calendar-year season', () => {
    const y = statsFor(stats(matches, { period: { kind: 'season', id: '2026' } }), 'peter');
    expect(y.appearances).toBe(2);
    expect(y.goals).toBe(1);
  });

  it('filters by month', () => {
    expect(statsFor(stats(matches, { period: { kind: 'month', id: '2026-01' } }), 'peter').appearances).toBe(1);
  });

  it('supports configurable seasons that straddle new year', () => {
    const period = { kind: 'season', id: '2025-26' } as const;
    const all = matchesForPeriod(matches, period, 8);
    expect(all.map((m) => m.date)).toEqual(['2025-12-29', '2026-01-05', '2026-02-02']);
    expect(matchesForPeriod(matches, { kind: 'season', id: '2026-27' }, 8)).toHaveLength(0);
  });
});

describe('leaderboards', () => {
  it('applies a minimum-appearances threshold to rate boards only', () => {
    const matches = Array.from({ length: 6 }, (_, i) =>
      mkMatch({
        date: addDays('2026-02-02', i * 7),
        a: i < 2 ? ['peter', 'adam'] : ['adam'],
        b: ['alex'],
        score: [1, 0],
        events: [goal('a', i < 2 ? 'peter' : 'adam')],
      }),
    );
    const winPct = buildLeaderboard(stats(matches).values(), 'winPct', { minAppearances: 5 });
    // Peter won 2 of 2 (100%) but has only 2 appearances, so he is excluded from the rate board.
    expect(winPct.map((r) => r.stats.playerId)).toEqual(['adam', 'alex']);
    expect(winPct[0]).toMatchObject({ value: 100 });
    // On a plain counting board the same player appears.
    const wins = buildLeaderboard(stats(matches).values(), 'wins', { minAppearances: 5 });
    expect(wins.map((r) => r.stats.playerId)).toContain('peter');
  });

  it('gives tied players the same rank', () => {
    const m = mkMatch({
      a: ['peter', 'adam'],
      b: ['alex', 'tom'],
      score: [2, 0],
      events: [goal('a', 'peter'), goal('a', 'adam')],
    });
    const rows = buildLeaderboard(stats([m]).values(), 'goals', { minAppearances: 1 });
    expect(rows.map((r) => [r.stats.playerId, r.rank, r.tied])).toEqual([
      ['adam', 1, true],
      ['peter', 1, true],
    ]);
  });

  it('scales the minimum down for short periods', () => {
    expect(minAppearancesFor(40, 5)).toBe(5);
    expect(minAppearancesFor(8, 5)).toBe(4);
    expect(minAppearancesFor(4, 5)).toBe(2);
    expect(minAppearancesFor(1, 5)).toBe(1);
  });

  it('ranks the current winning streak', () => {
    const matches = [
      mkMatch({ date: '2026-03-02', a: ['peter', 'adam'], b: ['alex'], score: [1, 0] }),
      mkMatch({ date: '2026-03-09', a: ['peter'], b: ['adam', 'alex'], score: [1, 0] }),
      mkMatch({ date: '2026-03-16', a: ['peter'], b: ['adam', 'alex'], score: [1, 0] }),
    ];
    const rows = buildLeaderboard(stats(matches).values(), 'winStreak', { minAppearances: 1 });
    expect(rows[0]).toMatchObject({ value: 3 });
    expect(rows[0]!.stats.playerId).toBe('peter');
    expect(rows.find((r) => r.stats.playerId === 'adam')).toBeUndefined(); // lost the last two
  });
});

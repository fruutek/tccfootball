import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildMatchFacts } from '../src/shared/facts';
import { buildLeaderboard } from '../src/shared/leaderboards';
import { computeStats, startingTotalsOf, statsFor } from '../src/shared/stats';
import type { Player } from '../src/shared/schema';
import { HomeView } from '../src/components/HomeView';
import { LeaderboardView } from '../src/components/LeaderboardView';
import { PlayerProfile, PlayersDirectory } from '../src/components/PlayerViews';
import { EMPTY_DATA, type SiteData } from '../src/lib/data';
import { getIndex } from '../src/lib/view';
import { MemoryStore } from '../cli/store';
import { execute } from '../cli/services/execute';
import { auditData } from '../cli/services/integrity';
import { planPublishMatch } from '../cli/services/matches';
import { planAddPlayer, planAddPlayers, planUpdatePlayer } from '../cli/services/players';
import type { Ctx } from '../cli/types';
import { goal, mkMatch, mkPlayer } from './helpers';

const ctx: Ctx = { now: new Date('2026-11-04T10:00:00Z'), today: '2026-11-04', actor: 'test' };
const withTotals = (id: string, name: string, goals: number): Player => ({ ...mkPlayer(id, name), startingTotals: { goals } });

describe('starting totals in the statistics engine', () => {
  const players = [withTotals('peter', 'Peter', 3), withTotals('kj', 'KJ', 3), mkPlayer('adam', 'Adam')];

  it('add to ALL-TIME goals for a player with no recorded matches, without inventing appearances', () => {
    const s = computeStats([], { startingTotals: startingTotalsOf(players) });
    expect(statsFor(s, 'peter')).toMatchObject({ goals: 3, startingGoals: 3, appearances: 0, wins: 0, goalsPerGame: 0 });
    expect(s.has('adam')).toBe(false); // nothing stated, nothing shown
  });

  it('add to recorded goals, but per-game averages use recorded matches only', () => {
    const m = mkMatch({ a: ['peter', 'adam'], b: ['kj', 'tom'], score: [2, 0], events: [goal('a', 'peter'), goal('a', 'peter')] });
    const s = statsFor(computeStats([m], { startingTotals: startingTotalsOf(players) }), 'peter');
    expect(s.goals).toBe(5); // 3 before records + 2 recorded
    expect(s.startingGoals).toBe(3);
    expect(s.appearances).toBe(1);
    expect(s.goalsPerGame).toBe(2); // 2 recorded goals / 1 recorded game — NOT 5
  });

  it('never leak into season or month views (their dates are unknown)', () => {
    const m = mkMatch({ date: '2026-01-05', a: ['peter'], b: ['kj'], score: [1, 0], events: [goal('a', 'peter')] });
    const st = startingTotalsOf(players);
    expect(statsFor(computeStats([m], { startingTotals: st, period: { kind: 'season', id: '2026' } }), 'peter').goals).toBe(1);
    expect(statsFor(computeStats([m], { startingTotals: st, period: { kind: 'month', id: '2026-01' } }), 'peter').goals).toBe(1);
    expect(computeStats([], { startingTotals: st, period: { kind: 'season', id: '2026' } }).size).toBe(0);
  });

  it('put players on the scoring board with no matches, but keep them off appearance and rate boards', () => {
    const s = computeStats([], { startingTotals: startingTotalsOf(players) });
    const goals = buildLeaderboard(s.values(), 'goals', { minAppearances: 1 });
    expect(goals.map((r) => [r.stats.playerId, r.value, r.rank])).toEqual([['kj', 3, 1], ['peter', 3, 1]]);
    for (const key of ['appearances', 'wins', 'winPct', 'goalsPerGame', 'potm', 'winStreak', 'assists'] as const) {
      expect(buildLeaderboard(s.values(), key, { minAppearances: 1 }), key).toEqual([]);
    }
  });

  it('are included in career figures and milestones in fact sheets', () => {
    const m = mkMatch({ date: '2026-11-02', a: ['peter', 'adam'], b: ['kj', 'tom'], score: [2, 0], events: [goal('a', 'peter'), goal('a', 'peter')] });
    const roster = [withTotals('peter', 'Peter', 3), mkPlayer('adam', 'Adam'), withTotals('kj', 'KJ', 3), mkPlayer('tom', 'Tom')];
    const f = buildMatchFacts(m.id, [m], roster);
    const peter = f.players.find((p) => p.playerId === 'peter')!;
    expect(peter.careerGoals).toBe(5);
    expect(peter.milestones).toContain('5th career goal'); // 3 + 2 crosses 5
    expect(peter.debut).toBe(true); // still his first RECORDED appearance
  });
});

describe('creating a roster', () => {
  const names = [{ name: 'Peter', startingTotals: { goals: 3 } }, { name: 'Andrew', startingTotals: { goals: 1 } }, { name: 'Steve A' }, { name: 'Steve P' }, { name: 'Daisy', startingTotals: { goals: 0 } }];

  it('creates everyone in ONE atomic plan, with zero starting totals dropped and unique stable ids', async () => {
    const store = new MemoryStore();
    const plan = planAddPlayers(await store.load(), { players: names, instruction: 'Initial roster' }, ctx);
    expect(plan.ok, JSON.stringify(plan.errors)).toBe(true);
    expect(plan.ops).toHaveLength(5);
    const out = await execute(store, plan, ctx, true);
    expect(out.applied).toBe(true);
    const snap = await store.load();
    expect(snap.players.map((p) => p.id).sort()).toEqual(['andrew', 'daisy', 'peter', 'steve-a', 'steve-p']);
    expect(snap.players.find((p) => p.id === 'peter')!.startingTotals).toEqual({ goals: 3 });
    expect(snap.players.find((p) => p.id === 'daisy')!.startingTotals).toBeUndefined();
    expect(snap.players.every((p) => !p.photo && !p.fictional)).toBe(true); // blank pictures, nothing fictional
    expect(snap.matches).toHaveLength(0);
    expect(plan.warnings.map((w) => w.code)).toContain('FIRST_NAME_OVERLAP'); // Steve A / Steve P
    expect(auditData(snap, ctx).problems).toEqual([]);
  });

  it('is all-or-nothing: one bad name means nobody is created', async () => {
    const store = new MemoryStore();
    const plan = planAddPlayers(await store.load(), { players: [{ name: 'Peter' }, { name: 'peter' }, { name: 'Andrew' }] }, ctx);
    expect(plan.ok).toBe(false);
    expect(plan.errors.map((e) => e.code)).toContain('PLAYER_EXISTS');
    await execute(store, plan, ctx, true);
    expect((await store.load()).players).toHaveLength(0);
  });

  it('matches names to the new roster, asks about the ambiguous "Steve", and a published match adds to the starting totals', async () => {
    const store = new MemoryStore();
    await execute(store, planAddPlayers(await store.load(), { players: names }, ctx), ctx, true);
    const req = (a: string[], b: string[]) => ({
      date: '2026-11-02',
      teams: { a: { name: 'Red Team', players: a }, b: { name: 'Blue Team', players: b } },
      score: { a: 1, b: 0 },
      events: [{ type: 'goal', player: 'Peter' }],
    });
    const ambiguous = planPublishMatch(await store.load(), req(['Peter', 'Steve'], ['Andrew', 'Daisy']), ctx);
    expect(ambiguous.status).toBe('needs-clarification');
    expect(ambiguous.clarifications[0]!.candidates!.map((c) => c.playerId).sort()).toEqual(['steve-a', 'steve-p']);

    const ok = planPublishMatch(await store.load(), req(['Peter', 'Steve A'], ['Andrew', 'Daisy']), ctx);
    expect(ok.ok, JSON.stringify(ok.errors)).toBe(true);
    // The preview shows the numbers the site will show: 3 starting + 1 recorded.
    expect(ok.details.statChangeLines.find((l) => l.startsWith('Peter'))).toContain('goals 3→4');
    await execute(store, ok, ctx, true);
    const snap = await store.load();
    const peter = statsFor(computeStats(snap.matches, { startingTotals: startingTotalsOf(snap.players) }), 'peter');
    expect(peter).toMatchObject({ goals: 4, startingGoals: 3, appearances: 1 });
    expect(auditData(snap, ctx).problems).toEqual([]); // match cross-checks are unaffected by starting totals
  });

  it('can change or remove starting totals later, with the change recorded', async () => {
    const store = new MemoryStore();
    await execute(store, planAddPlayer(await store.load(), { name: 'Peter', startingTotals: { goals: 3 } }, ctx), ctx, true);
    const set = planUpdatePlayer(await store.load(), 'Peter', { startingTotals: { goals: 4 } }, ctx);
    expect(set.details.changes.join(' ')).toContain('4 goals');
    await execute(store, set, ctx, true);
    expect((await store.load()).players[0]!.startingTotals).toEqual({ goals: 4 });
    await execute(store, planUpdatePlayer(await store.load(), 'Peter', { startingTotals: null }, ctx), ctx, true);
    expect((await store.load()).players[0]!.startingTotals).toBeUndefined();
  });
});

describe('what the site shows before any match has been recorded', () => {
  const roster: Player[] = [withTotals('peter', 'Peter', 3), withTotals('kj', 'KJ', 3), mkPlayer('katie', 'Katie')];
  const data: SiteData = { ...EMPTY_DATA, players: roster };
  const idx = getIndex(data);
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('lists every player in the directory', () => {
    const t = text(renderToStaticMarkup(<PlayersDirectory idx={idx} />));
    for (const n of ['Peter', 'KJ', 'Katie']) expect(t).toContain(n);
  });

  it('shows a starting-totals profile honestly, and an untouched one as zero', () => {
    const p = text(renderToStaticMarkup(<PlayerProfile idx={idx} playerId="peter" />));
    expect(p).toMatch(/Goals\s*3/);
    expect(p).toContain('incl. 3 before match records');
    expect(p).toContain('before match records began');
    expect(p).not.toContain('Match history'); // no matches, no invented history
    const k = text(renderToStaticMarkup(<PlayerProfile idx={idx} playerId="katie" />));
    expect(k).toContain('Yet to make an appearance');
  });

  it('shows the scoring chart with the starting goals, and explains them', () => {
    const t = text(renderToStaticMarkup(<LeaderboardView idx={idx} initial={{ board: 'goals' }} />));
    expect(t).toMatch(/Peter/);
    expect(t).toMatch(/KJ/);
    expect(t).not.toContain('Katie');
    expect(t).toContain('include goals recorded before match tracking began');
    const season = text(renderToStaticMarkup(<LeaderboardView idx={idx} initial={{ board: 'goals', period: { kind: 'season', id: '2026' } }} />));
    expect(season).toContain('count in All-time only');
  });

  it('keeps the empty home page, but adds the scorers who exist', () => {
    const t = text(renderToStaticMarkup(<HomeView idx={idx} today="2026-11-04" />));
    expect(t).toContain('Kick-off soon');
    expect(t).toContain('Top scorers');
    expect(t).toContain('Peter');
    const none = text(renderToStaticMarkup(<HomeView idx={getIndex({ ...EMPTY_DATA, players: [mkPlayer('katie', 'Katie')] })} today="2026-11-04" />));
    expect(none).not.toContain('Top scorers');
  });
});

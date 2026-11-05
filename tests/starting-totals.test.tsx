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
import { planAddPlayer, planAddPlayers, planUpdatePlayer, planUpdatePlayers } from '../cli/services/players';
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


/* ============================ preseason appearances ============================ */

const preseason = (id: string, name: string, appearances: number, goals = 0): Player => ({
  ...mkPlayer(id, name),
  startingTotals: { appearances, ...(goals ? { goals } : {}) },
});

describe('preseason appearances', () => {
  const roster = [preseason('peter', 'Peter', 4, 3), preseason('katie', 'Katie', 3, 1), preseason('george', 'George', 1), mkPlayer('tom', 'Tom')];
  const st = startingTotalsOf(roster);

  it('count as appearances, with goals per game from the preseason pair — and NO results', () => {
    const s = statsFor(computeStats([], { startingTotals: st }), 'peter');
    expect(s).toMatchObject({ totalAppearances: 4, startingAppearances: 4, appearances: 0, goals: 3, wins: 0, draws: 0, losses: 0, winPct: 0 });
    expect(s.goalsPerGame).toBe(0.75); // 3 goals in 4 games
    expect(computeStats([], { startingTotals: st }).has('george')).toBe(true); // appearances alone are enough to exist
    expect(computeStats([], { startingTotals: st }).has('tom')).toBe(false);
  });

  it('keep win rate and W/D/L on recorded matches only', () => {
    const m = mkMatch({ a: ['peter', 'tom'], b: ['katie', 'george'], score: [2, 0], events: [goal('a', 'peter'), goal('a', 'tom')] });
    const peter = statsFor(computeStats([m], { startingTotals: st }), 'peter');
    expect(peter.appearances).toBe(1); // recorded
    expect(peter.totalAppearances).toBe(5); // 4 preseason + 1 recorded
    expect(peter.winPct).toBe(100); // 1 win / 1 RECORDED game — not 1/5
    expect([peter.wins, peter.draws, peter.losses]).toEqual([1, 0, 0]);
    expect(peter.goalsPerGame).toBe(0.8); // (3 + 1) goals / 5 games
    const katie = statsFor(computeStats([m], { startingTotals: st }), 'katie');
    expect([katie.wins, katie.losses, katie.winPct]).toEqual([0, 1, 0]);
    expect(katie.totalAppearances).toBe(4);
  });

  it('never let goals without a games count (or the reverse) distort an average', () => {
    const lopsided: Player[] = [{ ...mkPlayer('a', 'A'), startingTotals: { goals: 5 } }];
    const m = mkMatch({ a: ['a', 'x'], b: ['y', 'z'], score: [1, 0], events: [goal('a', 'a')] });
    expect(statsFor(computeStats([m], { startingTotals: startingTotalsOf(lopsided) }), 'a').goalsPerGame).toBe(1); // 1 recorded goal / 1 recorded game
  });

  it('stay out of season and month views', () => {
    const m = mkMatch({ date: '2026-11-02', a: ['peter'], b: ['tom'], score: [1, 0], events: [goal('a', 'peter')] });
    const season = statsFor(computeStats([m], { startingTotals: st, period: { kind: 'season', id: '2026' } }), 'peter');
    expect(season).toMatchObject({ totalAppearances: 1, goals: 1, startingAppearances: 0 });
  });

  it('rank on the appearances board by total games, but not on the win-rate board', () => {
    const s = computeStats([], { startingTotals: st });
    const apps = buildLeaderboard(s.values(), 'appearances', { minAppearances: 1 });
    expect(apps.map((r) => [r.stats.playerId, r.value])).toEqual([['peter', 4], ['katie', 3], ['george', 1]]);
    expect(buildLeaderboard(s.values(), 'winPct', { minAppearances: 1 })).toEqual([]); // no tracked results yet
    const gpg = buildLeaderboard(s.values(), 'goalsPerGame', { minAppearances: 1 });
    expect(gpg.map((r) => [r.stats.playerId, r.value])).toEqual([['katie', 1 / 3], ['peter', 0.75]].sort((x, y) => (y[1] as number) - (x[1] as number)));
  });

  it('never call a regular a debutant, and count preseason games towards appearance milestones', () => {
    const m = mkMatch({ date: '2026-11-02', a: ['peter', 'tom'], b: ['katie', 'george'], score: [1, 0], events: [goal('a', 'peter')] });
    const f = buildMatchFacts(m.id, [m], [...roster, mkPlayer('x', 'X')]);
    const peter = f.players.find((p) => p.playerId === 'peter')!;
    expect(peter.debut).toBe(false); // 4 preseason games already
    expect(peter.careerAppearances).toBe(5);
    expect(peter.milestones).toContain('5th appearance');
    expect(f.players.find((p) => p.playerId === 'tom')!.debut).toBe(true); // genuinely new
    expect(f.statements.join(' ')).not.toContain("Peter's first appearance");
  });
});

describe('changing many players at once (restarting the numbers)', () => {
  const setup = async () => {
    const store = new MemoryStore();
    await execute(store, planAddPlayers(await store.load(), { players: [{ name: 'Peter', startingTotals: { goals: 3 } }, { name: 'Dan W', startingTotals: { goals: 3 } }, { name: 'Antony' }, { name: 'Katie' }] }, ctx), ctx, true);
    return store;
  };

  it('replaces every starting total in one atomic step, and can add an alias', async () => {
    const store = await setup();
    const plan = planUpdatePlayers(await store.load(), {
      updates: [
        { player: 'Peter', startingTotals: { appearances: 4, goals: 3 } },
        { player: 'Dan W', startingTotals: { appearances: 3, goals: 2 } },
        { player: 'Antony', startingTotals: { appearances: 4, goals: 1 }, addAliases: ['Ant'] },
        { player: 'Katie', startingTotals: { appearances: 3, goals: 1 } },
      ],
      instruction: 'Restart preseason totals',
    }, ctx);
    expect(plan.ok, JSON.stringify(plan.errors)).toBe(true);
    expect(plan.ops).toHaveLength(4);
    await execute(store, plan, ctx, true);
    const snap = await store.load();
    const by = (id: string) => snap.players.find((p) => p.id === id)!;
    expect(by('dan-w').startingTotals).toEqual({ appearances: 3, goals: 2 }); // 3 → 2: replaced, not added
    expect(by('antony').aliases).toEqual(['Ant']);
    expect(auditData(snap, ctx).problems).toEqual([]);
    // "Ant" now resolves in a published result.
    const m = planPublishMatch(snap, { date: '2026-11-02', teams: { a: { name: 'A', players: ['Ant', 'Peter'] }, b: { name: 'B', players: ['Dan', 'Katie'] } }, score: { a: 0, b: 0 } }, ctx);
    expect(m.ok, JSON.stringify([m.errors, m.clarifications])).toBe(true);
  });

  it('is all-or-nothing: an unknown name or a repeated player writes nothing', async () => {
    const store = await setup();
    const before = JSON.stringify((await store.load()).players);
    const unknown = planUpdatePlayers(await store.load(), { updates: [{ player: 'Peter', startingTotals: { appearances: 4 } }, { player: 'Zinedine', startingTotals: { appearances: 1 } }] }, ctx);
    expect(unknown.status).toBe('needs-clarification');
    await execute(store, unknown, ctx, true);
    const dup = planUpdatePlayers(await store.load(), { updates: [{ player: 'Peter', startingTotals: { appearances: 4 } }, { player: 'peter', startingTotals: { appearances: 5 } }] }, ctx);
    expect(dup.errors.map((e) => e.code)).toContain('DUPLICATE_UPDATE');
    await execute(store, dup, ctx, true);
    expect(JSON.stringify((await store.load()).players)).toBe(before);
  });

  it('skips players who are already up to date instead of failing', async () => {
    const store = await setup();
    const plan = planUpdatePlayers(await store.load(), { updates: [{ player: 'Peter', startingTotals: { goals: 3 } }, { player: 'Katie', startingTotals: { appearances: 3 } }] }, ctx);
    expect(plan.ok).toBe(true);
    expect(plan.details.skipped[0]).toContain('Peter');
    expect(plan.ops).toHaveLength(1);
  });
});

describe('what the site shows for preseason-only players', () => {
  const roster = [preseason('peter', 'Peter', 4, 3), preseason('george', 'George', 1), mkPlayer('katie', 'Katie')];
  const idx = getIndex({ ...EMPTY_DATA, players: roster });
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('profile: appearances and goals, labelled preseason, and NO win rate', () => {
    const t = text(renderToStaticMarkup(<PlayerProfile idx={idx} playerId="peter" />));
    expect(t).toMatch(/Appearances\s*4/);
    expect(t).toContain('preseason');
    expect(t).toMatch(/Goals \/ game\s*0\.75/);
    expect(t).not.toContain('Win rate');
    expect(t).not.toContain('Draws');
    const g = text(renderToStaticMarkup(<PlayerProfile idx={idx} playerId="george" />));
    expect(g).toMatch(/Appearances\s*1/);
    expect(g).not.toContain('Yet to make an appearance');
  });

  it('squad: total appearances, dash instead of a fake 0% win rate', () => {
    const html = renderToStaticMarkup(<PlayersDirectory idx={idx} />);
    expect(html).not.toContain('0%');
    expect(text(html)).toMatch(/Peter[\s\S]*?4 Apps 3 Goals/);
  });

  it('leaderboard: shows total apps and dashes for tracked-only columns', () => {
    const t = text(renderToStaticMarkup(<LeaderboardView idx={idx} initial={{ board: 'appearances' }} />));
    expect(t).toContain('Peter');
    expect(t).toContain('George');
    expect(t).toContain('–');
    expect(t).not.toContain('0%');
  });
});

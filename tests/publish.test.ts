import { beforeEach, describe, expect, it } from 'vitest';
import { computeStats, statsFor } from '../src/shared/stats';
import { MemoryStore, ConflictError } from '../cli/store';
import { planArticleStatus, planPublishArticle } from '../cli/services/articles';
import { planRevert } from '../cli/services/audit';
import { execute } from '../cli/services/execute';
import { auditData } from '../cli/services/integrity';
import { planEditMatch, planMatchStatus, planPublishMatch } from '../cli/services/matches';
import { planAddPlayer, planUpdatePlayer } from '../cli/services/players';
import { planClearFixture, planSetFixture } from '../cli/services/settings';
import type { Ctx } from '../cli/types';

const ctx: Ctx = { now: new Date('2026-11-04T10:00:00Z'), today: '2026-11-04', actor: 'test' };

async function seedRoster(store: MemoryStore, names = ['Peter', 'Adam', 'James', 'Chris', 'Arun', 'Alex', 'Brownie', 'Avalon', 'Josh', 'Tom']) {
  for (const name of names) {
    const plan = planAddPlayer(await store.load(), { name }, ctx);
    expect(plan.ok, JSON.stringify(plan.errors)).toBe(true);
    await execute(store, plan, ctx, true);
  }
}

/** The exact scenario from the brief. */
const example = () => ({
  date: '2026-11-02',
  teams: {
    a: { name: 'Red Team', colour: 'red', players: ['Peter', 'Adam', 'James', 'Chris', 'Arun'] },
    b: { name: 'Blue Team', colour: 'blue', players: ['Alex', 'Brownie', 'Avalon', 'Josh', 'Tom'] },
  },
  score: { a: 3, b: 0 },
  events: [
    { type: 'goal', player: 'Peter', count: 2 },
    { type: 'goal', player: 'James' },
    { type: 'assist', player: 'Adam' },
  ],
  playerOfTheMatch: 'Peter',
  instruction: "Monday's match finished 3-0 …",
});

let store: MemoryStore;
beforeEach(async () => {
  store = new MemoryStore();
  await seedRoster(store);
});

const publish = async (spec: unknown, apply = true) => {
  const plan = planPublishMatch(await store.load(), spec, ctx);
  return { plan, out: await execute(store, plan, ctx, apply) };
};

describe('publishing the example result', () => {
  it('resolves players, builds the match and credits the right stats', async () => {
    const { plan, out } = await publish(example());
    expect(plan.errors).toEqual([]);
    expect(plan.ok).toBe(true);
    expect(out.applied).toBe(true);
    expect(plan.details.matchId).toBe('2026-11-02');

    const snap = await store.load();
    const m = snap.matches[0]!;
    expect(m).toMatchObject({ id: '2026-11-02', status: 'published', score: { a: 3, b: 0 }, playerOfTheMatch: 'peter', revision: 1 });
    expect(m.teams.a.playerIds).toEqual(['peter', 'adam', 'james', 'chris', 'arun']);
    expect(m.teams.b.name).toBe('Blue Team');
    expect(m.events).toHaveLength(4);
    expect(m.playerIds).toHaveLength(10);

    const s = computeStats(snap.matches);
    expect(statsFor(s, 'peter')).toMatchObject({ goals: 2, wins: 1, potm: 1, appearances: 1 });
    expect(statsFor(s, 'james').goals).toBe(1);
    expect(statsFor(s, 'adam')).toMatchObject({ assists: 1, goals: 0 });
    expect(statsFor(s, 'tom')).toMatchObject({ losses: 1, goals: 0 });
  });

  it('is a dry run unless applied — nothing is written', async () => {
    const { plan, out } = await publish(example(), false);
    expect(plan.ok).toBe(true);
    expect(out.applied).toBe(false);
    expect((await store.load()).matches).toHaveLength(0);
    expect(store.audit).toHaveLength(10); // only the ten player creations
  });

  it('reports stat changes and a fact sheet for the report writer', async () => {
    const { plan } = await publish(example(), false);
    expect(plan.details.statChangeLines).toContain('Peter: appearances 0→1, goals 0→2, wins 0→1, potm 0→1');
    expect(plan.details.facts?.statements).toContain('Peter scored 2 goals.');
    expect(plan.details.facts?.result.line).toBe('Red Team 3–0 Blue Team');
  });

  it('writes the match, its report and bumps dataRevision atomically, with an audit trail', async () => {
    const before = (await store.load()).settings?.dataRevision ?? 0;
    const spec = { ...example(), report: { title: 'Peter double sinks Blue', standfirst: 'Red Team ran out 3–0 winners.', body: 'Peter scored twice and James added a third as Red Team won 3-0.' } };
    const { plan, out } = await publish(spec);
    expect(plan.warnings.filter((w) => w.code.startsWith('REPORT_'))).toEqual([]);
    const snap = await store.load();
    expect(snap.articles).toHaveLength(1);
    expect(snap.articles[0]).toMatchObject({ id: '2026-11-02-peter-double-sinks-blue', category: 'match-report', matchId: '2026-11-02', status: 'published' });
    expect(snap.settings!.dataRevision).toBeGreaterThan(before);
    const entries = await store.listAudit({ opId: out.opId });
    expect(entries.map((e) => `${e.collection}:${e.action}`).sort()).toEqual(['articles:create', 'matches:create']);
    expect(entries[0]!.instruction).toContain('finished 3-0');
  });
});

describe('ambiguous and unknown names', () => {
  it('asks instead of guessing when a first name matches two players', async () => {
    await seedRoster(store, ['Chris W']);
    // Rename the original "Chris" to "Chris B". His stable id stays "chris" — which must NOT
    // make a bare "Chris" quietly resolve to him now that "Chris W" exists too.
    const plan = planUpdatePlayer(await store.load(), 'Chris', { displayName: 'Chris B' }, ctx);
    await execute(store, plan, ctx, true);
    expect((await store.load()).players.find((p) => p.displayName === 'Chris B')!.id).toBe('chris');

    const { plan: p, out } = await publish(example());
    expect(p.status).toBe('needs-clarification');
    expect(p.clarifications).toHaveLength(1);
    expect(p.clarifications[0]).toMatchObject({ kind: 'ambiguous', input: 'Chris' });
    expect(p.clarifications[0]!.candidates!.map((c) => c.playerId).sort()).toEqual(['chris', 'chris-w']);
    expect(p.clarifications[0]!.question).toContain('id:chris-w');
    expect(out.applied).toBe(false);
    expect((await store.load()).matches).toHaveLength(0);
  });

  it('a clarified answer, passed back as id:<id>, then publishes cleanly', async () => {
    await seedRoster(store, ['Chris W']);
    await execute(store, planUpdatePlayer(await store.load(), 'Chris', { displayName: 'Chris B' }, ctx), ctx, true);
    const spec = example();
    spec.teams.a.players[3] = 'id:chris-w';
    const { out } = await publish(spec);
    expect(out.applied).toBe(true);
    expect((await store.load()).matches[0]!.teams.a.playerIds).toContain('chris-w');
  });

  it('never auto-creates an unknown player, and offers suggestions', async () => {
    const spec = example();
    spec.teams.b.players[4] = 'Tomm';
    const { plan, out } = await publish(spec);
    expect(plan.status).toBe('needs-clarification');
    expect(plan.clarifications[0]).toMatchObject({ kind: 'unknown', input: 'Tomm' });
    expect(plan.clarifications[0]!.suggestions!.map((s) => s.playerId)).toContain('tom');
    expect(out.applied).toBe(false);
    expect((await store.load()).players).toHaveLength(10);
  });
});

describe('score and scorer consistency', () => {
  it('refuses a score whose goals are not all accounted for, writing nothing', async () => {
    const spec = example();
    spec.events = [{ type: 'goal', player: 'Peter', count: 2 }];
    const { plan, out } = await publish(spec);
    expect(plan.status).toBe('invalid');
    expect(plan.errors.map((e) => e.code)).toContain('GOALS_UNACCOUNTED');
    expect(out.applied).toBe(false);
    expect((await store.load()).matches).toHaveLength(0);
  });

  it('accepts an explicitly unknown scorer, credits nobody, still counts the result', async () => {
    const spec = example();
    spec.events = [{ type: 'goal', player: 'Peter', count: 2 }, { type: 'goal', player: null, team: 'a' } as never];
    const { plan, out } = await publish(spec);
    expect(plan.warnings.map((w) => w.code)).toContain('UNKNOWN_SCORER');
    expect(out.applied).toBe(true);
    const s = computeStats((await store.load()).matches);
    expect(statsFor(s, 'peter').goals).toBe(2);
    expect(statsFor(s, 'james').goals).toBe(0);
    expect(statsFor(s, 'james').wins).toBe(1);
  });

  it('requires "team" for an unknown scorer rather than guessing', async () => {
    const spec = example();
    spec.events = [{ type: 'goal', player: 'Peter', count: 2 }, { type: 'goal', player: null } as never];
    const { plan } = await publish(spec);
    expect(plan.errors.map((e) => e.code)).toContain('EVENT_TEAM_REQUIRED');
  });

  it('infers an own goal as counting for the other team', async () => {
    const spec = example();
    spec.score = { a: 3, b: 1 };
    spec.events = [{ type: 'goal', player: 'Peter', count: 2 }, { type: 'goal', player: 'James' }, { type: 'own_goal', player: 'Chris' }] as never;
    const { plan, out } = await publish(spec);
    expect(plan.errors.map((e) => e.message)).toEqual([]);
    expect(out.applied).toBe(true);
    const m = (await store.load()).matches[0]!;
    expect(m.events.find((e) => e.type === 'own_goal')).toMatchObject({ playerId: 'chris', team: 'b' }); // Chris is Red → counts for Blue
    const s = computeStats([m]);
    expect(statsFor(s, 'chris')).toMatchObject({ goals: 0, ownGoals: 1 });
  });

  it('rejects a scorer who is not in either line-up', async () => {
    await seedRoster(store, ['Zed']);
    const spec = example();
    spec.events = [{ type: 'goal', player: 'Zed', count: 2 }, { type: 'goal', player: 'James' }, { type: 'assist', player: 'Adam' }];
    const { plan } = await publish(spec);
    expect(plan.errors.map((e) => e.code)).toContain('EVENT_PLAYER_NOT_IN_MATCH');
  });

  it('rejects a result dated in the future', async () => {
    const spec = { ...example(), date: '2026-11-09' };
    const { plan } = await publish(spec);
    expect(plan.errors.map((e) => e.code)).toContain('DATE_FUTURE');
  });
});

describe('duplicate prevention', () => {
  it('refuses to publish a second match on the same date', async () => {
    await publish(example());
    const { plan, out } = await publish(example());
    expect(plan.errors.map((e) => e.code)).toContain('MATCH_EXISTS');
    expect(out.applied).toBe(false);
    expect((await store.load()).matches).toHaveLength(1);
  });

  it('catches the same result re-sent with sides swapped and different team names — even as "game 2"', async () => {
    await publish(example());
    const swapped = {
      date: '2026-11-02',
      sequence: 2,
      teams: { a: { name: 'Bibs', players: ['Alex', 'Brownie', 'Avalon', 'Josh', 'Tom'] }, b: { name: 'Skins', players: ['Peter', 'Adam', 'James', 'Chris', 'Arun'] } },
      score: { a: 0, b: 3 },
      events: [{ type: 'goal', player: 'James' }, { type: 'goal', player: 'Peter', count: 2 }, { type: 'assist', player: 'Adam' }],
    };
    const { plan } = await publish(swapped);
    expect(plan.errors.map((e) => e.code)).toContain('DUPLICATE_RESULT');
    expect((await store.load()).matches).toHaveLength(1);
  });

  it('warns about a probable mistyped date, but allows a genuinely different game', async () => {
    await publish(example());
    const nextWeek = { ...example(), date: '2026-11-09' };
    const plan = planPublishMatch(await store.load(), nextWeek, { ...ctx, today: '2026-11-10' });
    expect(plan.ok).toBe(true);
    expect(plan.warnings.map((w) => w.code)).toContain('POSSIBLE_DUPLICATE');
  });

  it('is safe against two plans made at the same time (the store refuses the second write)', async () => {
    const snap = await store.load();
    const p1 = planPublishMatch(snap, example(), ctx);
    const p2 = planPublishMatch(snap, example(), ctx);
    await execute(store, p1, ctx, true);
    await expect(execute(store, p2, ctx, true)).rejects.toBeInstanceOf(ConflictError);
    expect((await store.load()).matches).toHaveLength(1);
  });

  it('allows an explicit second game on the same day', async () => {
    await publish(example());
    const second = { ...example(), sequence: 2, score: { a: 1, b: 0 }, events: [{ type: 'goal', player: 'Arun' }], playerOfTheMatch: null };
    const { plan, out } = await publish(second);
    expect(plan.errors).toEqual([]);
    expect(out.applied).toBe(true);
    expect(plan.details.matchId).toBe('2026-11-02-2');
  });
});

describe('editing historical results', () => {
  const week = (date: string, scorer: string) => ({
    ...example(),
    date,
    events: [{ type: 'goal', player: scorer, count: 3 }],
    playerOfTheMatch: scorer,
  });

  async function history() {
    await publish(week('2026-10-12', 'Peter'));
    await publish(week('2026-10-19', 'James'));
    await publish({ ...example(), date: '2026-10-26' });
  }

  it('recalculates every affected player when a scorer is corrected', async () => {
    await history();
    expect(statsFor(computeStats((await store.load()).matches), 'peter').goals).toBe(5); // 3 + 0 + 2

    // The first match was actually won by James hat-trick, not Peter.
    const snap = await store.load();
    const fixed = { ...week('2026-10-12', 'James') };
    const plan = planEditMatch(snap, '2026-10-12', fixed, ctx);
    expect(plan.ok, JSON.stringify(plan.errors)).toBe(true);
    expect(plan.details.changes.join(' ')).toContain('goals / assists changed');
    expect(plan.details.statChangeLines).toEqual(
      expect.arrayContaining(['Peter: goals 5→2, potm 2→1', 'James: goals 4→7, potm 1→2']),
    );
    await execute(store, plan, ctx, true);

    const after = computeStats((await store.load()).matches);
    expect(statsFor(after, 'peter')).toMatchObject({ goals: 2, potm: 1, appearances: 3 });
    expect(statsFor(after, 'james')).toMatchObject({ goals: 7, potm: 2 });
  });

  it('keeps the id, bumps the revision and preserves createdAt', async () => {
    await history();
    const before = (await store.load()).matches.find((m) => m.id === '2026-10-12')!;
    const plan = planEditMatch(await store.load(), '2026-10-12', { ...week('2026-10-12', 'Peter'), score: { a: 4, b: 0 }, events: [{ type: 'goal', player: 'Peter', count: 4 }] }, ctx);
    await execute(store, plan, ctx, true);
    const after = (await store.load()).matches.find((m) => m.id === '2026-10-12')!;
    expect(after).toMatchObject({ id: '2026-10-12', revision: before.revision + 1, createdAt: before.createdAt });
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it('records the previous version in the audit log and can be reverted', async () => {
    await history();
    const plan = planEditMatch(await store.load(), '2026-10-12', { ...week('2026-10-12', 'James') }, ctx);
    const out = await execute(store, plan, ctx, true);
    const entries = await store.listAudit({ opId: out.opId });
    expect(entries[0]!.before).toMatchObject({ playerOfTheMatch: 'peter' });
    expect(entries[0]!.after).toMatchObject({ playerOfTheMatch: 'james' });

    const rev = planRevert(await store.load(), entries, 'op_revert', ctx);
    expect(rev.ok, JSON.stringify(rev.errors)).toBe(true);
    await execute(store, rev, ctx, true, { markReverted: rev.details.entryIds });
    const restored = (await store.load()).matches.find((m) => m.id === '2026-10-12')!;
    expect(restored.playerOfTheMatch).toBe('peter');
    expect(statsFor(computeStats((await store.load()).matches), 'peter').goals).toBe(5);
    expect((await store.listAudit({ opId: out.opId }))[0]!.revertedBy).toBeTruthy();
  });

  it('refuses to revert an old change over a later one', async () => {
    await history();
    const out1 = await execute(store, planEditMatch(await store.load(), '2026-10-12', week('2026-10-12', 'James'), ctx), ctx, true);
    await execute(store, planEditMatch(await store.load(), '2026-10-12', { ...week('2026-10-12', 'James'), venue: 'Astro 3' }, ctx), ctx, true);
    const rev = planRevert(await store.load(), await store.listAudit({ opId: out1.opId }), 'x', ctx);
    expect(rev.ok).toBe(false);
    expect(rev.errors[0]!.code).toBe('CHANGED_SINCE');
  });

  it('refuses an edit that would duplicate a different match, or change nothing', async () => {
    await history();
    const snap = await store.load();
    const dupOf = planEditMatch(snap, '2026-10-12', { ...example(), date: '2026-10-26' }, ctx);
    expect(dupOf.errors.map((e) => e.code)).toContain('DUPLICATE_RESULT');
    const current = snap.matches.find((m) => m.id === '2026-10-12')!;
    const same = planEditMatch(snap, '2026-10-12', week('2026-10-12', 'Peter'), ctx);
    expect(current.score).toEqual({ a: 3, b: 0 });
    expect(same.errors.map((e) => e.code)).toContain('NO_CHANGES');
  });

  it('warns when an edit leaves a stale match report', async () => {
    await publish({ ...week('2026-10-12', 'Peter'), report: { title: 'Peter hat-trick', standfirst: 'Peter scored three.', body: 'Peter scored three times.' } });
    const plan = planEditMatch(await store.load(), '2026-10-12', week('2026-10-12', 'James'), ctx);
    expect(plan.warnings.map((w) => w.code)).toContain('REPORT_STALE');
  });

  it('lets a corrected report ride along with the edit', async () => {
    await publish({ ...week('2026-10-12', 'Peter'), report: { title: 'Peter hat-trick', standfirst: 'Peter scored three.', body: 'Peter scored three times.' } });
    const plan = planEditMatch(await store.load(), '2026-10-12', { ...week('2026-10-12', 'James'), report: { title: 'James hat-trick', standfirst: 'James scored three.', body: 'James scored three times.' } }, ctx);
    expect(plan.ok).toBe(true);
    expect(plan.details.article).toMatchObject({ action: 'update' });
    await execute(store, plan, ctx, true);
    const arts = (await store.load()).articles;
    expect(arts).toHaveLength(1);
    expect(arts[0]).toMatchObject({ title: 'James hat-trick', revision: 2 });
  });
});

describe('unpublishing, republishing and deleting', () => {
  it('removes an unpublished match from all statistics and brings it — and its report — back on republish', async () => {
    await publish({ ...example(), report: { title: 'Red win', standfirst: 'x', body: 'y' } });
    const unpub = planMatchStatus(await store.load(), '2026-11-02', 'unpublish', ctx);
    expect(unpub.ops).toHaveLength(2); // match + its report
    await execute(store, unpub, ctx, true);
    let snap = await store.load();
    expect(computeStats(snap.matches).size).toBe(0);
    expect(snap.articles[0]!.status).toBe('unpublished');

    const repub = planMatchStatus(snap, '2026-11-02', 'republish', ctx);
    expect(repub.ops).toHaveLength(2);
    expect(repub.warnings.map((w) => w.code)).not.toContain('REPORT_STILL_UNPUBLISHED');
    await execute(store, repub, ctx, true);
    snap = await store.load();
    expect(statsFor(computeStats(snap.matches), 'peter').goals).toBe(2);
    expect(snap.articles[0]!.status).toBe('published');
  });

  it('does not resurrect a report that was unpublished separately', async () => {
    await publish({ ...example(), report: { title: 'Red win', standfirst: 'x', body: 'y' } });
    const slug = (await store.load()).articles[0]!.id;
    await execute(store, planArticleStatus(await store.load(), slug, 'unpublish', ctx), ctx, true);
    const later = { ...ctx, now: new Date('2026-11-04T11:00:00Z') };
    await execute(store, planMatchStatus(await store.load(), '2026-11-02', 'unpublish', later), later, true);
    const repub = planMatchStatus(await store.load(), '2026-11-02', 'republish', { ...ctx, now: new Date('2026-11-04T12:00:00Z') });
    expect(repub.ops).toHaveLength(1); // the match only
    expect(repub.warnings.map((w) => w.code)).toContain('REPORT_STILL_UNPUBLISHED');
  });

  it('deletes a match with its report, and revert brings both back', async () => {
    await publish({ ...example(), report: { title: 'Red win', standfirst: 'x', body: 'y' } });
    const del = planMatchStatus(await store.load(), '2026-11-02', 'delete', ctx);
    const out = await execute(store, del, ctx, true);
    expect((await store.load()).matches).toHaveLength(0);
    expect((await store.load()).articles).toHaveLength(0);
    const rev = planRevert(await store.load(), await store.listAudit({ opId: out.opId }), 'r', ctx);
    expect(rev.ok, JSON.stringify(rev.errors)).toBe(true);
    await execute(store, rev, ctx, true, { markReverted: rev.details.entryIds });
    expect((await store.load()).matches).toHaveLength(1);
    expect((await store.load()).articles).toHaveLength(1);
  });
});

describe('players', () => {
  it('assigns stable slug ids and refuses duplicate display names', async () => {
    const snap = await store.load();
    expect(snap.players.map((p) => p.id)).toContain('peter');
    expect(planAddPlayer(snap, { name: 'peter' }, ctx).errors[0]!.code).toBe('PLAYER_EXISTS');
  });

  it('warns about first-name overlap and uses a distinct id', async () => {
    const plan = planAddPlayer(await store.load(), { name: 'Peter Hughes' }, ctx);
    expect(plan.ok).toBe(true);
    expect(plan.warnings.map((w) => w.code)).toContain('FIRST_NAME_OVERLAP');
    expect(plan.details.playerId).toBe('peter-hughes');
  });

  it('keeps the id when a display name changes, so history is untouched', async () => {
    await publish(example());
    const plan = planUpdatePlayer(await store.load(), 'Peter', { displayName: 'Peter Hughes', nickname: 'Pistol Pete' }, ctx);
    await execute(store, plan, ctx, true);
    const snap = await store.load();
    expect(snap.players.find((p) => p.id === 'peter')).toMatchObject({ displayName: 'Peter Hughes', nickname: 'Pistol Pete' });
    expect(statsFor(computeStats(snap.matches), 'peter').goals).toBe(2);
  });
});

describe('fixtures and articles', () => {
  it('clears the next fixture automatically once its date is played', async () => {
    await execute(store, planSetFixture(await store.load(), { date: '2026-11-09', kickoff: '19:30' }, ctx), ctx, true);
    expect((await store.load()).settings!.nextFixture?.date).toBe('2026-11-09');
    await publish(example()); // 2 Nov — before the fixture
    expect((await store.load()).settings!.nextFixture?.date).toBe('2026-11-09');
    const later = { ...example(), date: '2026-11-09' };
    const p = planPublishMatch(await store.load(), later, { ...ctx, today: '2026-11-10' });
    await execute(store, p, ctx, true);
    expect((await store.load()).settings!.nextFixture).toBeNull();
    expect(planClearFixture(await store.load(), ctx).errors[0]!.code).toBe('NO_CHANGE');
  });

  it('publishes, unpublishes and deletes articles, refusing slug collisions', async () => {
    const spec = { title: 'Meet the squad', standfirst: 'Who is who.', body: 'Hello.', category: 'humour' };
    const out = await execute(store, planPublishArticle(await store.load(), spec, ctx), ctx, true);
    expect(out.applied).toBe(true);
    expect(planPublishArticle(await store.load(), spec, ctx).errors[0]!.code).toBe('SLUG_EXISTS');
    await execute(store, planArticleStatus(await store.load(), 'meet-the-squad', 'unpublish', ctx), ctx, true);
    expect((await store.load()).articles[0]!.status).toBe('unpublished');
    await execute(store, planArticleStatus(await store.load(), 'meet-the-squad', 'delete', ctx), ctx, true);
    expect((await store.load()).articles).toHaveLength(0);
  });

  it('flags report prose that contradicts the recorded data', async () => {
    const spec = { ...example(), report: { title: 'Red cruise', standfirst: 'Red led 1-0 at half-time', body: 'A penalty and a hat-trick for Tom, who was absent.' } };
    const { plan } = await publish(spec, false);
    const codes = plan.warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(['REPORT_SCORELINE', 'REPORT_UNRECORDED_DETAIL', 'REPORT_HATTRICK']));
  });
});

describe('integrity audit', () => {
  it('passes on clean data and totals add up', async () => {
    await publish(example());
    const r = auditData(await store.load(), ctx);
    expect(r.problems).toEqual([]);
    expect(r.totals).toMatchObject({ matches: 1, goals: 3, assists: 1, appearances: 10 });
    expect(r.table[0]).toMatchObject({ player: 'Peter', goals: 2 });
  });

  it('detects a match tampered with outside the CLI', async () => {
    await publish(example());
    const m = store.data.matches.get('2026-11-02')!;
    (m['score'] as { a: number }).a = 5;
    const r = auditData(await store.load(), ctx);
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.code)).toEqual(expect.arrayContaining(['GOALS_UNACCOUNTED', 'FINGERPRINT_MISMATCH']));
  });
});

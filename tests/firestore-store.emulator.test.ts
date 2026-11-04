import { execFileSync, spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeStats, statsFor } from '../src/shared/stats';
import { connect } from '../cli/firebase';
import { ConflictError } from '../cli/store';
import { planRevert } from '../cli/services/audit';
import { seedDemo } from '../cli/services/demo';
import { execute } from '../cli/services/execute';
import { auditData } from '../cli/services/integrity';
import { planEditMatch, planPublishMatch } from '../cli/services/matches';
import { planAddPlayer } from '../cli/services/players';
import type { Ctx } from '../cli/types';
import { clearEmulator } from './emulator-helpers';

const PROJECT = 'demo-mnf';
const ctx: Ctx = { now: new Date('2026-11-04T10:00:00Z'), today: '2026-11-04', actor: 'test' };
const { store, db } = connect({ project: PROJECT });

beforeEach(async () => {
  await clearEmulator(PROJECT);
});

async function roster(names: string[]) {
  for (const name of names) await execute(store, planAddPlayer(await store.load(), { name }, ctx), ctx, true);
}

const spec = (over: Record<string, unknown> = {}) => ({
  date: '2026-11-02',
  teams: { a: { name: 'Red Team', players: ['Peter', 'Adam'] }, b: { name: 'Blue Team', players: ['Alex', 'Tom'] } },
  score: { a: 2, b: 0 },
  events: [{ type: 'goal', player: 'Peter', count: 2 }],
  playerOfTheMatch: 'Peter',
  ...over,
});

describe('FirestoreStore against the emulator', () => {
  it('creates settings on first write and bumps dataRevision on every commit', async () => {
    expect((await store.load()).settings).toBeNull();
    await roster(['Peter']);
    const r1 = (await store.load()).settings!.dataRevision;
    expect(r1).toBeGreaterThan(0);
    await roster(['Adam']);
    expect((await store.load()).settings!.dataRevision).toBeGreaterThan(r1);
    expect((await store.load()).settings).toMatchObject({ siteName: 'Monday Night Football', seasonStartMonth: 1 });
  });

  it('round-trips a published match and derives the right stats from what is stored', async () => {
    await roster(['Peter', 'Adam', 'Alex', 'Tom']);
    const out = await execute(store, planPublishMatch(await store.load(), spec(), ctx), ctx, true);
    expect(out.applied).toBe(true);
    const snap = await store.load();
    expect(snap.matches[0]).toMatchObject({ id: '2026-11-02', status: 'published', score: { a: 2, b: 0 }, revision: 1 });
    expect(statsFor(computeStats(snap.matches), 'peter')).toMatchObject({ goals: 2, wins: 1, potm: 1 });
    expect(auditData(snap, ctx).problems).toEqual([]);
  });

  it('refuses a duplicate even when two plans were prepared before either was applied', async () => {
    await roster(['Peter', 'Adam', 'Alex', 'Tom']);
    const snap = await store.load();
    const p1 = planPublishMatch(snap, spec(), ctx);
    const p2 = planPublishMatch(snap, spec(), ctx);
    await execute(store, p1, ctx, true);
    await expect(execute(store, p2, ctx, true)).rejects.toBeInstanceOf(ConflictError);
    expect((await store.load()).matches).toHaveLength(1);
  });

  it('is atomic: a conflicting op means NONE of the writes land', async () => {
    await roster(['Peter', 'Adam', 'Alex', 'Tom']);
    const snap = await store.load();
    const withReport = planPublishMatch(snap, spec({ report: { title: 'Peter double', standfirst: 's', body: 'b' } }), ctx);
    expect(withReport.ops).toHaveLength(2);
    // Someone else publishes the same report slug in the meantime.
    await db.collection('articles').doc(withReport.details.article!.slug).set({ id: 'x', status: 'published', revision: 1 });
    await expect(execute(store, withReport, ctx, true)).rejects.toBeInstanceOf(ConflictError);
    expect((await store.load()).matches).toHaveLength(0); // the match write was rolled back too
  });

  it('detects an edit made from stale data (optimistic concurrency)', async () => {
    await roster(['Peter', 'Adam', 'Alex', 'Tom']);
    await execute(store, planPublishMatch(await store.load(), spec(), ctx), ctx, true);
    const stale = await store.load();
    const mine = planEditMatch(stale, '2026-11-02', spec({ playerOfTheMatch: 'Adam' }), ctx);
    const theirs = planEditMatch(stale, '2026-11-02', spec({ venue: 'Astro 3' }), ctx);
    await execute(store, theirs, ctx, true);
    await expect(execute(store, mine, ctx, true)).rejects.toThrow(/modified by someone else/);
    expect((await store.load()).matches[0]).toMatchObject({ venue: 'Astro 3', playerOfTheMatch: 'peter' });
  });

  it('keeps an audit trail and can revert an edit', async () => {
    await roster(['Peter', 'Adam', 'Alex', 'Tom']);
    await execute(store, planPublishMatch(await store.load(), spec({ instruction: 'Monday was 2-0' }), ctx), ctx, true);
    const edit = await execute(store, planEditMatch(await store.load(), '2026-11-02', spec({ playerOfTheMatch: 'Adam' }), ctx), ctx, true);
    const entries = await store.listAudit({ opId: edit.opId });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'update', collection: 'matches', docId: '2026-11-02', actor: 'test' });
    expect(entries[0]!.before).toMatchObject({ playerOfTheMatch: 'peter' });

    const rev = planRevert(await store.load(), entries, 'op_revert', ctx);
    await execute(store, rev, ctx, true, { markReverted: rev.details.entryIds });
    expect((await store.load()).matches[0]!.playerOfTheMatch).toBe('peter');
    expect((await store.listAudit({ opId: edit.opId }))[0]!.revertedBy).toBeTruthy();
    const recent = await store.listAudit({ limit: 3 });
    expect(recent.length).toBe(3);
    expect(recent[0]!.at >= recent[1]!.at).toBe(true);
  });

  it('seeds demo data that passes the integrity audit', async () => {
    const r = await seedDemo(store, ctx);
    expect(r.ok, r.lines.join('\n')).toBe(true);
    const snap = await store.load();
    expect(snap.matches).toHaveLength(10);
    expect(auditData(snap, ctx).problems).toEqual([]);
  });
});

describe('the mnf command line, end to end', () => {
  const env = { ...process.env, FIRESTORE_EMULATOR_HOST: process.env['FIRESTORE_EMULATOR_HOST']!, MNF_TODAY: '2026-11-04', MNF_PROJECT: PROJECT };
  const run = (args: string[], input?: string) => {
    const r = spawnSync('npx', ['tsx', 'cli/index.ts', ...args], { env, input, encoding: 'utf8', cwd: process.cwd() });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it("publishes the brief's example message: dry run first, then --apply, then refuses a repeat", { timeout: 120_000 }, async () => {
    // One player through the real CLI (arg parsing, dry run, --apply)…
    const dryAdd = run(['player', 'add', '--name', 'Peter']);
    expect(dryAdd.code).toBe(0);
    expect(dryAdd.out).toContain('DRY RUN');
    expect((await store.load()).players).toHaveLength(0);
    expect(run(['player', 'add', '--name', 'Peter', '--apply']).code).toBe(0);
    // …and the rest of the roster in-process, to keep the suite fast.
    await roster(['Adam', 'James', 'Chris', 'Arun', 'Alex', 'Brownie', 'Avalon', 'Josh', 'Tom']);
    const request = JSON.stringify({
      date: '2026-11-02',
      teams: {
        a: { name: 'Red Team', colour: 'red', players: ['Peter', 'Adam', 'James', 'Chris', 'Arun'] },
        b: { name: 'Blue Team', colour: 'blue', players: ['Alex', 'Brownie', 'Avalon', 'Josh', 'Tom'] },
      },
      score: { a: 3, b: 0 },
      events: [{ type: 'goal', player: 'Peter', count: 2 }, { type: 'goal', player: 'James' }, { type: 'assist', player: 'Adam' }],
      playerOfTheMatch: 'Peter',
      instruction: "Monday's match finished 3-0 …",
    });

    const dry = run(['match', 'publish', '--stdin'], request);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('DRY RUN');
    expect(dry.out).toContain('Red Team 3–0 Blue Team');
    expect(dry.out).toContain('FACT SHEET');
    expect(dry.out).toContain('Peter scored 2 goals.');
    expect((await store.load()).matches).toHaveLength(0);

    const real = run(['match', 'publish', '--stdin', '--apply'], request);
    expect(real.code).toBe(0);
    expect(real.out).toContain('Done');
    expect(real.out).toContain('/matches/2026-11-02');
    expect(real.out).toMatch(/revert op_\w+ --apply/);

    const again = run(['match', 'publish', '--stdin', '--apply'], request);
    expect(again.code).toBe(2);
    expect(again.out).toContain('MATCH_EXISTS');
    expect((await store.load()).matches).toHaveLength(1);

    const audit = run(['stats', 'audit', '--table']);
    expect(audit.code).toBe(0);
    expect(audit.out).toContain('AUDIT PASSED');
  });

  it('asks about an ambiguous name and exits non-zero without writing', { timeout: 60_000 }, async () => {
    await roster(['Chris B', 'Chris W', 'Tom']);
    const r = run(['match', 'publish', '--stdin', '--apply'], JSON.stringify({
      date: '2026-11-02',
      teams: { a: { name: 'Red', players: ['Chris'] }, b: { name: 'Blue', players: ['Tom'] } },
      score: { a: 0, b: 0 },
    }));
    expect(r.code).toBe(2);
    expect(r.out).toContain('NEEDS YOUR INPUT');
    expect(r.out).toContain('Chris B');
    expect(r.out).toContain('id:chris-w');
    expect((await store.load()).matches).toHaveLength(0);
  });

  it('prints help and fails clearly on bad input', () => {
    expect(run(['help']).out).toContain('DRY RUN');
    const bad = run(['match', 'publish', '--stdin'], '{not json');
    expect(bad.code).toBe(64);
    expect(bad.out).toContain('not valid JSON');
  });
});

void execFileSync;
